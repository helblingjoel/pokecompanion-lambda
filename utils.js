export function checkEnvVars(vars) {
	vars.forEach((envVar) => {
		if (!process.env[envVar]) {
			console.error(`No ${process.env[envVar]} specified`);
			return false;
		}
	});
	return true;
}
