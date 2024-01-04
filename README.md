# pokecompanion-lambda

Collecion of Lambdas to periodically poll the PokeAPI to get high-level exports.

## supervisor

The supervisor's job is to compare the current state of the Pocketbase DB, with the PokeAPI.

For example, when the PokeAPI's /pokemon endpoint shows that the total number of known Pokemon has increased, then it should find out what the most recent information in the DB is, and post a message to the SQS queue with instructions to fetch the missing Pokemon.

If language entries in the Pocketbase DB are not present, the supervisor should attempt to get these updated.

The responsibility here ends with the Queue. Processing the items off the queue will be handled by another set of Lambdas.

## worker

The worker's job is to process entries pushed to the SQS Queue by the Supervisor. It should fetch the corresponding new entry off the PokeAPI and update the Pocketbase entry accordingly

If an entry already exists, it should update it. Otherwise, create it.

Once the Pocketbase entry is update, the worker's repsonsibility ends. It is not responsible for triggering a fresh build.

### SQS Formats

| Sample body          | Meaning       | API Endpoint                  |
| -------------------- | ------------- | ----------------------------- |
| `{ pokemonEntry: 1}` | Pokemon Names | /api/v2/pokemon-species/${id} |

## redeploy

The redeploy function should be triggered when the Queue is known to have been processed.

It will authentication against the Pocketbase instance, create an export of the static collections and update a new deployment of the Pokecompanion - if and only if there have been changes.

# Architecture diagram

![Diagram](.github/diagram.svg)
