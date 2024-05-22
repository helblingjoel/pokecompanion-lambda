import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { checkEnvVars } from "./utils.js";
import { getAuthedPb } from "./pocketbase.js";
import newrelic from 'newrelic'

export async function handler(event, context) {
	newrelic.setLambdaHandler(async (event) => {
		try {
			await main();
		} catch (err) {
			console.log(err);
		}
		return;
  });
	return newrelic.lambdaHandler()(event, context);
}

const main = async () => {
	if (
		!checkEnvVars([
			"POCKETBASE_URL",
			"QUEUE_URL",
			"ADMIN_EMAIL",
			"ADMIN_PASSWORD",
		])
	) {
		console.error("Missing env variable");
		return;
	}
	console.log("All env vars present");

	const pb = await getAuthedPb();
	if (!pb) {
		return;
	}

	const {
		lastMonDbEntry,
		lastMonDbExtraEntry,
		lastMonAPIEntry,
		lastAPIMonExtraEntry,
	} = await findLastPokemon(pb);
	const { lastMoveDbEntry, lastMoveAPIEntry } = await findLastMove(pb);

	console.log(
		`Pokemon       - PB Entry ${lastMonDbEntry} | API Entry ${lastMonAPIEntry}`
	);

	console.log(
		`Pokemon Extra - PB Entry ${lastMonDbExtraEntry} | API Entry ${lastAPIMonExtraEntry}`
	);
	console.log(
		`Move          - PB Entry ${lastMoveDbEntry} | API Entry ${lastMoveAPIEntry}`
	);

	const allQueueMessages = [];
	const client = new SQSClient({
		region: "eu-west-2",
	});

	for (let i = lastMonDbEntry; i < lastMonAPIEntry; i++) {
		allQueueMessages.push(
			sendSQSMessage(client, {
				pokemonEntry: i + 1,
			})
		);
	}

	for (let i = lastMonDbExtraEntry; i < lastAPIMonExtraEntry; i++) {
		allQueueMessages.push(
			sendSQSMessage(client, {
				pokemonExtra: i + 1,
			})
		);
	}

	for (let i = lastMoveDbEntry; i < lastMoveAPIEntry; i++) {
		allQueueMessages.push(
			sendSQSMessage(client, {
				moveEntry: i + 1,
			})
		);
	}
	await Promise.all(allQueueMessages);

	// Should expand this to cover missing name entries as well
};

async function findLastPokemon(pb) {
	console.log("Getting last PB Pokemon entry");
	const lastDBMonEntry = await pb.collection("pokemon_names").getFullList({
		sort: "-national_dex",
		filter: "national_dex < 10001",
	});

	console.log(`Getting last Pokemon API entry`);
	const lastApiMonEntry = await fetch(
		"https://pokeapi.co/api/v2/pokemon-species"
	);
	const apiResponseBody = await lastApiMonEntry.json();
	console.log(
		`Last Pokemon API Entry is ${JSON.stringify(apiResponseBody.count)}`
	);

	const lastDBMonExtraEntry = await pb.collection("pokemon_names").getFullList({
		sort: "-national_dex",
		filter: "national_dex > 10000",
	});

	const lastAPIMonExtraEntry = await findLastAPIExtraMon(
		lastDBMonExtraEntry.length !== 0
			? lastDBMonExtraEntry[0].national_dex
			: 10001
	);

	return {
		lastMonDbEntry:
			lastDBMonEntry.length !== 0 ? lastDBMonEntry[0].national_dex : 0,
		lastMonDbExtraEntry:
			lastDBMonExtraEntry.length !== 0
				? lastDBMonExtraEntry[0].national_dex
				: 10000,
		lastMonAPIEntry: apiResponseBody.count,
		lastAPIMonExtraEntry,
	};
}

async function findLastAPIExtraMon(initialId) {
	let lastId = initialId;
	let previousResponse = 200;

	while (previousResponse === 200) {
		console.log(`Request to https://pokeapi.co/api/v2/pokemon/${lastId}`);
		try {
			const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${lastId}`);
			if (!res.ok) {
				console.log(res.status);
				previousResponse = res.status;
				break;
			}
			await res.json();
			lastId += 1;
		} catch (error) {
			console.log(error);
			previousResponse = 500;
			break;
		}
	}

	return lastId;
}

async function findLastMove(pb) {
	console.log("Getting last PB move entry");
	const lastDBMoveEntry = await pb.collection("moves").getFullList({
		sort: "-id",
	});
	console.log(
		`Last PB Move Entry is ${
			lastDBMoveEntry.length !== 0 ? lastDBMoveEntry[0].move_id : 0
		}`
	);

	console.log(`Getting last Move API entry`);
	const lastApiMoveEntry = await fetch("https://pokeapi.co/api/v2/move");
	const apiResponseBody = await lastApiMoveEntry.json();
	console.log(
		`Last Move API Entry is ${JSON.stringify(apiResponseBody.count)}`
	);

	return {
		lastMoveDbEntry:
			lastDBMoveEntry.length !== 0 ? lastDBMoveEntry[0].move_id : 0,
		lastMoveAPIEntry: apiResponseBody.count,
	};
}

async function sendSQSMessage(client, message) {
	try {
		const command = new SendMessageCommand({
			QueueUrl: process.env.QUEUE_URL,
			MessageBody: JSON.stringify(message),
		});

		const response = await client.send(command);
		console.log(response);
	} catch (err) {
		console.error(`Failed to send message to queue: ${err}`);
	}
}

// handler();
