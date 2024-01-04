module.exports = {
	branches: ["main"],
	plugins: [
		"@semantic-release/commit-analyzer",
		"@semantic-release/release-notes-generator",
		"@semantic-release/changelog",
		[
			"@semantic-release/github",
			{
				assets: [
					{ path: "supervisor.zip", label: "supervisor.zip" },
					{ path: "worker.zip", label: "worker.zip" },
					{ path: "redeploy.zip", label: "redeploy.zip" },
				],
			},
		],
	],
};
