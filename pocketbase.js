import Pocketbase from "pocketbase";

export async function getAuthedPb() {
	console.log('\nSigning into Pocketbase');
	try {
		const pb = new Pocketbase(process.env.POCKETBASE_URL);
		await pb
			.collection("users")
			.authWithPassword(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
		console.log("  OK: Signed in");
		return pb;
	} catch (err) {
		console.error("  Error: Failed to authenticate", err);
		return;
	}
}
