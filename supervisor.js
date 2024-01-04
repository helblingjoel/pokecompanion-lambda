import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { checkEnvVars } from "./utils.js";
import { getAuthedPb } from "./pocketbase.js";

export async function handler(event, context) {
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

	const { lastDbEntry, lastApiEntry } = await findLastPokemon(pb);
	console.log(
		`Last PB Entry: ${lastDbEntry} - Last API Entry: ${lastApiEntry}`
	);

	const allQueueMessages = [];
	const client = new SQSClient({
		region: "eu-west-2",
	});

	for (let i = lastDbEntry; i < lastApiEntry; i++) {
		allQueueMessages.push(
			sendSQSMessage(client, {
				pokemonEntry: i + 1,
			})
		);
	}

	await Promise.all(allQueueMessages);

	// Should expand this to cover missing name entrie as well
}

async function findLastPokemon(pb) {
	console.log("Getting last PB entry");
	const lastDBMonEntry = await pb.collection("pokemon_names").getFullList({
		sort: "-national_dex",
	});
	console.log(`Last PB Entry is ${lastDBMonEntry}`);

	console.log(`Getting last API entry`);
	const lastApiMonEntry = await fetch(
		"https://pokeapi.co/api/v2/pokemon-species"
	);
	const apiResponseBody = await lastApiMonEntry.json();
	console.log(`Last API Entry is ${JSON.stringify(apiResponseBody.count)}`);

	return {
		lastDbEntry:
			lastDBMonEntry.length !== 0 ? lastDBMonEntry[0].national_dex : 0,
		lastApiEntry: apiResponseBody.count,
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
