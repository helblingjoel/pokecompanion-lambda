import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { checkEnvVars } from "./utils.js";
import { getAuthedPb } from "./pocketbase.js";
import newrelic from 'newrelic'

export async function handler(event, context) {
	async function mainFunction(){
		try {
			await main();
		} catch (err) {
			console.log(err);
		}
		return;
	}

	if (process.env.NODE_ENV === 'production'){
		newrelic.setLambdaHandler(async (event) => {
			mainFunction()
		});
	  return newrelic.lambdaHandler()(event, context);
	} else {
		mainFunction();
	}
}

const main = async () => {
	console.log('Checking environment variables...')
	if (
		!checkEnvVars([
			"POCKETBASE_URL",
			"QUEUE_URL",
			"ADMIN_EMAIL",
			"ADMIN_PASSWORD",
		])
	) {
		console.error("  ERROR: Missing env variable");
		return;
	}
	console.log("  OK: All env vars present");

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

	console.log('\nFinished data fetching')

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

	console.log('=== Done ===')
};

async function findLastPokemon(pb) {
	console.log("\nGetting last PB Pokemon entry...");
	const lastDBMonEntry = await pb.collection("pokemon_names").getFullList({
		sort: "-national_dex",
		filter: "national_dex < 10001",
	});
	console.log ('  OK: Last entry is', lastDBMonEntry[0]?.national_dex ?? 0)

	console.log(`\nGetting last Pokemon API entry`);
	const lastApiMonEntry = await fetch(
		"https://pokeapi.co/api/v2/pokemon-species"
	);
	const apiResponseBody = await lastApiMonEntry.json();
	console.log(
		`  OK: Last entry is ${Number(apiResponseBody.count)}`
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

	console.log('\nGetting last API Extra Pokemon')
	while (previousResponse === 200) {
		console.log(`  Request to https://pokeapi.co/api/v2/pokemon/${lastId}`);
		try {
			const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${lastId}`);
			if (!res.ok) {
				console.log('    HTTP Status:', res.status);
				previousResponse = res.status;
				lastId -= 1;
			} else {
				console.log('    OK');
				await res.json();
				lastId += 1;
			}
		} catch (error) {
			console.log(error);
			previousResponse = 500;
			break;
		}
	}

	return lastId;
}

async function findLastMove(pb) {
	console.log("\nGetting last PB move entry");
	const lastDBMoveEntry = await pb.collection("moves").getFullList({
		sort: "-move_id",
	});
	console.log(
		`  OK: Last PB Move Entry is ${
			lastDBMoveEntry.length !== 0 ? lastDBMoveEntry[0].move_id : 0
		}`
	);

	console.log(`\nGetting last Move API entry`);
	const lastApiMoveEntry = await fetch("https://pokeapi.co/api/v2/move");
	const apiResponseBody = await lastApiMoveEntry.json();

	// Moves that have an ID > 10000 are Shadow moves that we don't care about.
	// This is unlikely to change in the future
	const shadowMovesCount = 18;

	console.log(
		`  OK: Last API Move Entry is ${JSON.stringify(apiResponseBody.count - shadowMovesCount)}`
	);


	return {
		lastMoveDbEntry:
			lastDBMoveEntry.length !== 0 ? lastDBMoveEntry[0].move_id : 0,
		lastMoveAPIEntry: apiResponseBody.count - shadowMovesCount,
	};
}

async function sendSQSMessage(client, message) {
	console.log('\nSending SQS message:', message);
	try {
		const command = new SendMessageCommand({
			QueueUrl: process.env.QUEUE_URL,
			MessageBody: JSON.stringify(message),
		});

		const response = await client.send(command);
		console.log('  OK');
	} catch (err) {
		console.error(`  Error: ${err}`);
	}
}

// handler();
