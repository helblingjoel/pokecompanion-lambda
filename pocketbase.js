import Pocketbase from "pocketbase";

export async function getAuthedPb() {
	try {
		const pb = new Pocketbase(process.env.POCKETBASE_URL);
		await pb
			.collection("users")
			.authWithPassword(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
		console.log("Signed into Pocketbase");
		return pb;
	} catch (err) {
		console.error("Failed to auth to PB", err);
		return;
	}
}
