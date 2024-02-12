import { checkEnvVars } from "./utils.js";
import { getAuthedPb } from "./pocketbase.js";

export async function handler(event, context) {
	try {
		await main(event);
	} catch (err) {
		console.log(err);
	}
	return;
}

const main = async (event) => {
	if (!checkEnvVars(["POCKETBASE_URL", "ADMIN_EMAIL", "ADMIN_PASSWORD"])) {
		console.error("Missing env variable");
		return;
	}

	const pb = await getAuthedPb();
	if (!pb) {
		return;
	}

	// There'll be multiple requests in-flight at the same time - don't cancel any
	// https://github.com/pocketbase/js-sdk#auto-cancellation
	pb.autoCancellation(false);

	const pokemonIds = event.Records.map((message) => {
		const parsedBody = JSON.parse(message.body);
		return parsedBody.pokemonEntry;
	}).filter((a) => a);

	const extraPokemonIds = event.Records.map((message) => {
		const parsedBody = JSON.parse(message.body);
		return parsedBody.pokemonExtra;
	})
		.filter((a) => a)
		.filter((a) => a > 10000);

	const moveIds = event.Records.map((message) => {
		const parsedBody = JSON.parse(message.body);
		return parsedBody.moveEntry;
	}).filter((a) => a);

	if (!pokemonIds && !moveIds && !extraPokemonIds) {
		return;
	}

	try {
		await Promise.all([
			processPokemon(pb, pokemonIds),
			processMove(pb, moveIds),
			processExtraPokemon(pb, extraPokemonIds),
		]);
	} catch (err) {
		console.log(err);
	}
	return;
};

async function processPokemon(pb, ids) {
	if (ids.length === 0) {
		console.log(`Skipping Pokemon`);
		return;
	}
	console.log(`Processing Pokemon - ${JSON.stringify(ids)}`);
	const pokemonApiResponses = await Promise.all(
		ids.map((id) => {
			return fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`, {
				headers: { "Accept-Encoding": "gzip,deflate,compress" },
			});
		})
	).catch((err) => {
		console.log(
			`Error(s) occurred while fetching Pokemon API responses: ${err}`
		);
	});
	console.log(`Pokemon - Received API Responses`);

	const pokemonBodies = await Promise.all(
		pokemonApiResponses.map((response) => {
			return response.json();
		})
	).catch((err) => {
		console.log(
			`Error(s) occurred while parsing Pokemon API responses: ${err}`
		);
	});

	console.log(`Pokemon - Parsed API responses`);

	const pbData = pokemonBodies.map((body) => {
		const id = body.pokedex_numbers.find((entry) => {
			return entry.pokedex.name === "national";
		})?.entry_number;

		return {
			national_dex: id,
			en: body.names.find((entry) => {
				return entry.language.name === "en";
			})?.name,
			de: body.names.find((entry) => {
				return entry.language.name === "de";
			})?.name,
			es: body.names.find((entry) => {
				return entry.language.name === "es";
			})?.name,
			it: body.names.find((entry) => {
				return entry.language.name === "it";
			})?.name,
			fr: body.names.find((entry) => {
				return entry.language.name === "fr";
			})?.name,
			ja_hrkt: body.names.find((entry) => {
				return entry.language.name === "ja-Hrkt";
			})?.name,
			zh_hans: body.names.find((entry) => {
				return entry.language.name === "zh-Hant";
			})?.name,
			generation: getPokemonGeneration(id),
		};
	});

	// Non-existing entries will reject
	const allExistingEntries = await Promise.allSettled(
		pbData.map((entry) => {
			return pb
				.collection("pokemon_names")
				.getFirstListItem(`national_dex=${entry.national_dex}`);
		})
	);
	const existingEntries = allExistingEntries
		.filter((entry) => {
			return entry.status === "fulfilled";
		})
		.map((entry) => {
			return entry.value;
		});
	console.log(
		`Pokemon - Found ${existingEntries.length} entries that will be updated`
	);

	// Find all entries that already exist and need to be updated
	const updateEntries = pbData.filter((a) => {
		return existingEntries.some((b) => {
			return a.national_dex === b.national_dex;
		});
	});

	// Find all entries that are new
	const newEntries = pbData.filter((a) => {
		return existingEntries.every((b) => {
			return a.national_dex !== b.national_dex;
		});
	});

	console.log(
		`Pokemon - Found ${newEntries.length} new entries that will be created`
	);

	// Update all existing entries
	const updatedResults = await Promise.allSettled(
		updateEntries.map((entry) => {
			const existingEntry = existingEntries.find((a) => {
				return a.national_dex === entry.national_dex;
			});
			return pb.collection("pokemon_names").update(existingEntry.id, entry);
		})
	).catch((err) => {
		console.error(
			`Pokemon - Error when trying to update existing entries: ${err}`
		);
	});

	let successfulUpdates = 0;
	let failedUpdates = 0;
	const failedErrorMessages = [];
	updatedResults.forEach((entry) => {
		if (entry.status === "fulfilled") {
			successfulUpdates++;
		} else {
			failedUpdates++;
			failedErrorMessages.push(entry);
		}
	});

	if (failedUpdates === 0) {
		console.log(`Pokemon - No errors when updating existing entries`);
	} else {
		console.error(
			`Pokemon - ${failedUpdates} entries have failed to update. Error messages:`
		);
		console.error(JSON.stringify(failedErrorMessages));
	}

	// Create all existing entries
	const createdResults = await Promise.allSettled(
		newEntries.map((entry) => {
			return pb.collection("pokemon_names").create(entry);
		})
	);

	let successfulCreations = 0;
	let failedCreations = 0;
	const failedCreationErrorMessages = [];
	createdResults.forEach((entry) => {
		if (entry.status === "fulfilled") {
			successfulCreations++;
		} else {
			failedCreations++;
			failedCreationErrorMessages.push(entry);
		}
	});

	if (failedCreations === 0) {
		console.log(`Pokemon - No errors when creating new entries`);
	} else {
		console.error(
			`Pokemon - ${failedCreations} entries have not been created. Error messages:`
		);
		console.error(JSON.stringify(failedCreationErrorMessages));
	}
}

async function processExtraPokemon(pb, ids) {
	if (ids.length === 0) {
		console.log(`Skipping Extra Pokemon`);
		return;
	}
	console.log(`Processing Extra Pokemon - ${JSON.stringify(ids)}`);
	const pokemonApiResponses = await Promise.all(
		ids.map((id) => {
			return fetch(`https://pokeapi.co/api/v2/pokemon/${id}`, {
				headers: { "Accept-Encoding": "gzip,deflate,compress" },
			});
		})
	).catch((err) => {
		console.log(
			`Error(s) occurred while fetching Extra Pokemon API responses: ${err}`
		);
	});
	console.log(`Extra Pokemon - Received API Responses`);

	const pokemonBodies = await Promise.all(
		pokemonApiResponses.map((response) => {
			return response.json();
		})
	).catch((err) => {
		console.log(
			`Error(s) occurred while parsing Extra Pokemon API responses: ${err}`
		);
	});

	const pokemonFormResponses = await Promise.all(
		pokemonBodies.map(async (body) => {
			const defaultForm = body.forms[0].url;
			return fetch(defaultForm, {
				headers: { "Accept-Encoding": "gzip,deflate,compress" },
			}).then((res) => {
				return res.json();
			});
		})
	).catch((err) => {
		console.log(
			`Error(s) occurred while fetching Extra Pokemon Form API responses: ${err}`
		);
	});

	console.log(`Extra Pokemon - Parsed API responses`);

	const pbData = pokemonFormResponses.map((body) => {
		const pokemon = pokemonBodies.find((a) => {
			return a.id === Number(body.pokemon.url.split("/")[6]);
		});

		return {
			national_dex: pokemon.id,
			en: body.names.find((entry) => {
				return entry.language.name === "en";
			})?.name,
			de: body.names.find((entry) => {
				return entry.language.name === "de";
			})?.name,
			es: body.names.find((entry) => {
				return entry.language.name === "es";
			})?.name,
			it: body.names.find((entry) => {
				return entry.language.name === "it";
			})?.name,
			fr: body.names.find((entry) => {
				return entry.language.name === "fr";
			})?.name,
			ja_hrkt: body.names.find((entry) => {
				return entry.language.name === "ja-Hrkt";
			})?.name,
			zh_hans: body.names.find((entry) => {
				return entry.language.name === "zh-Hant";
			})?.name,
			generation: getPokemonGeneration(body.id),
			redirect: `${
				body.pokemon.species
					? body.pokemon.species.url.split("/")[6]
					: pokemon.species.url.split("/")[6]
			}?variety=${body.name}`,
		};
	});

	// Non-existing entries will reject
	const allExistingEntries = await Promise.allSettled(
		pbData.map((entry) => {
			return pb
				.collection("pokemon_names")
				.getFirstListItem(`national_dex=${entry.national_dex}`);
		})
	);
	const existingEntries = allExistingEntries
		.filter((entry) => {
			return entry.status === "fulfilled";
		})
		.map((entry) => {
			return entry.value;
		});
	console.log(
		`Extra Pokemon - Found ${existingEntries.length} entries that will be updated`
	);

	// Find all entries that already exist and need to be updated
	const updateEntries = pbData.filter((a) => {
		return existingEntries.some((b) => {
			return a.national_dex === b.national_dex;
		});
	});

	// Find all entries that are new
	const newEntries = pbData.filter((a) => {
		return existingEntries.every((b) => {
			return a.national_dex !== b.national_dex;
		});
	});

	console.log(
		`Extra Pokemon - Found ${newEntries.length} new entries that will be created`
	);

	// Update all existing entries
	const updatedResults = await Promise.allSettled(
		updateEntries.map((entry) => {
			const existingEntry = existingEntries.find((a) => {
				return a.national_dex === entry.national_dex;
			});
			return pb.collection("pokemon_names").update(existingEntry.id, entry);
		})
	).catch((err) => {
		console.error(
			`Extra Pokemon - Error when trying to update existing entries: ${err}`
		);
	});

	let successfulUpdates = 0;
	let failedUpdates = 0;
	const failedErrorMessages = [];
	updatedResults.forEach((entry) => {
		if (entry.status === "fulfilled") {
			successfulUpdates++;
		} else {
			failedUpdates++;
			failedErrorMessages.push(entry);
		}
	});

	if (failedUpdates === 0) {
		console.log(`Extra Pokemon - No errors when updating existing entries`);
	} else {
		console.error(
			`Extra Pokemon - ${failedUpdates} entries have failed to update. Error messages:`
		);
		console.error(JSON.stringify(failedErrorMessages));
	}

	// Create all existing entries
	const createdResults = await Promise.allSettled(
		newEntries.map((entry) => {
			return pb.collection("pokemon_names").create(entry);
		})
	);

	let successfulCreations = 0;
	let failedCreations = 0;
	const failedCreationErrorMessages = [];
	createdResults.forEach((entry) => {
		if (entry.status === "fulfilled") {
			successfulCreations++;
		} else {
			failedCreations++;
			failedCreationErrorMessages.push(entry);
		}
	});

	if (failedCreations === 0) {
		console.log(`Extra Pokemon - No errors when creating new entries`);
	} else {
		console.error(
			`Extra Pokemon - ${failedCreations} entries have not been created. Error messages:`
		);
		console.error(JSON.stringify(failedCreationErrorMessages));
	}
}

async function processMove(pb, ids) {
	if (ids.length === 0) {
		console.log("Skipping Moves");
		return;
	}
	console.log(`Processing Moves - ${JSON.stringify(ids)}`);
	const moveApiResponses = await Promise.all(
		ids.map((id) => {
			return fetch(`https://pokeapi.co/api/v2/move/${id}`, {
				headers: { "Accept-Encoding": "gzip,deflate,compress" },
			});
		})
	).catch((err) => {
		console.log(`Error(s) occurred while fetching Move API responses: ${err}`);
	});
	console.log(`Move - Received API Responses`);

	const moveBodies = await Promise.all(
		moveApiResponses.map((response) => {
			return response.json();
		})
	).catch((err) => {
		console.log(`Error(s) occurred while parsing Move API responses: ${err}`);
	});

	console.log(`Move - Parsed API Responses`);

	const pbData = moveBodies.map((body) => {
		return {
			move_id: body.id,
			en: body.names.find((entry) => {
				return entry.language.name === "en";
			})?.name,
			de: body.names.find((entry) => {
				return entry.language.name === "de";
			})?.name,
			es: body.names.find((entry) => {
				return entry.language.name === "es";
			})?.name,
			it: body.names.find((entry) => {
				return entry.language.name === "it";
			})?.name,
			fr: body.names.find((entry) => {
				return entry.language.name === "fr";
			})?.name,
			ja_hrkt: body.names.find((entry) => {
				return entry.language.name === "ja-Hrkt";
			})?.name,
			zh_hans: body.names.find((entry) => {
				return entry.language.name === "zh-Hant";
			})?.name,
		};
	});

	// Non-existing entries will reject
	const allExistingEntries = await Promise.allSettled(
		pbData.map((entry) => {
			return pb.collection("moves").getFirstListItem(`move_id=${entry.id}`);
		})
	);

	const existingEntries = allExistingEntries
		.filter((entry) => {
			return entry.status === "fulfilled";
		})
		.map((entry) => {
			return entry.value;
		});
	console.log(
		`Move - Found ${existingEntries.length} entries that will be updated`
	);

	// Find all entries that already exist and need to be updated
	const updateEntries = pbData.filter((a) => {
		return existingEntries.some((b) => {
			return a.move_id === b.move_id;
		});
	});

	// Find all entries that are new
	const newEntries = pbData.filter((a) => {
		return existingEntries.every((b) => {
			return a.move_id !== b.move_id;
		});
	});

	console.log(
		`Moves - Found ${newEntries.length} new entries that will be created`
	);

	// Update all existing entries
	const updatedResults = await Promise.allSettled(
		updateEntries.map((entry) => {
			const existingEntry = existingEntries.find((a) => {
				return a.move_id === b.move_id;
			});
			return pb.collection("moves").update(existingEntry.id, entry);
		})
	).catch((err) => {
		console.error(
			`Move - Error when trying to update existing entries: ${err}`
		);
	});

	let successfulUpdates = 0;
	let failedUpdates = 0;
	const failedErrorMessages = [];
	updatedResults.forEach((entry) => {
		if (entry.status === "fulfilled") {
			successfulUpdates++;
		} else {
			failedUpdates++;
			failedErrorMessages.push(entry);
		}
	});

	if (failedUpdates === 0) {
		console.log(`Move - No errors when updating existing entries`);
	} else {
		console.error(
			`Move - ${failedUpdates} entries have failed to update. Error messages:`
		);
		console.error(JSON.stringify(failedErrorMessages));
	}

	const createdResults = await Promise.allSettled(
		newEntries.map((entry) => {
			return pb.collection("moves").create(entry);
		})
	);

	let successfulCreations = 0;
	let failedCreations = 0;
	const failedCreationErrorMessages = [];
	createdResults.forEach((entry) => {
		if (entry.status === "fulfilled") {
			successfulCreations++;
		} else {
			failedCreations++;
			failedCreationErrorMessages.push(entry);
		}
	});

	if (failedCreations === 0) {
		console.log(`Move - No errors when creating new entries`);
	} else {
		console.error(
			`Move - ${failedCreations} entries have not been created. Error messages:`
		);
		console.error(JSON.stringify(failedCreationErrorMessages));
	}
}

const getPokemonGeneration = (id) => {
	if (id > 10000) {
		return -1;
	} else if (id <= 151) {
		return 1;
	} else if (id > 151 && id <= 252) {
		return 2;
	} else if (id > 252 && id <= 386) {
		return 3;
	} else if (id > 386 && id <= 493) {
		return 4;
	} else if (id > 492 && id <= 649) {
		return 5;
	} else if (id > 649 && id <= 721) {
		return 6;
	} else if (id > 721 && id <= 809) {
		return 7;
	} else if (id > 809 && id <= 905) {
		return 8;
	} else {
		return 9;
	}
};

// const testPayload = [{ body: `{"pokemonExtra":10166}` }];

// Pokemon
// for(let i = 1; i < 1025; i++){
// 	testPayload.push(`{"pokemon":${i}}`)
// }

// // Extra Pokemon
// for (let i = 10000; i < 10277; i++) {
// 	testPayload.push({ body: `{"pokemonExtra":${i}}` });
// }

// handler({
// 	Records: testPayload,
// });
