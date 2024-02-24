import dotenv from "dotenv";
dotenv.config();

export function checkEnvVars(vars) {
	vars.forEach((envVar) => {
		if (!process.env[envVar]) {
			console.error(`No ${envVar} specified`);
			return false;
		}
	});
	return true;
}
