(function () {
	var path = (window.location.pathname || "").replace(/\/$/, "");
	var redirects = [
		[/^\/app\/healthcare-practitioner(?:\/(.+))?$/i, "/app/doctor"],
		[/^\/app\/practitioner(?:\/(.+))?$/i, "/app/doctor"],
		[/^\/app\/patient$/i, "/app/health-patient"],
		[/^\/app\/patients(?:\/(.+))?$/i, "/app/health-patient"],
		[/^\/app\/List\/Patient$/i, "/app/health-patient"],
		[/^\/app\/Healthcare%20Practitioner$/i, "/app/doctor"]
	];

	for (var i = 0; i < redirects.length; i++) {
		var match = path.match(redirects[i][0]);
		if (!match) continue;
		var tail = match[1] ? decodeURIComponent(match[1]) : "";
		window.location.replace(redirects[i][1] + (tail ? "/" + tail : ""));
		return;
	}
})();
