frappe.pages["patient-encounter"].on_page_load = function () {
	var path = window.location.pathname || "";
	var segments = path.split("/").filter(Boolean);
	var slugIdx = segments.indexOf("patient-encounter");
	var tail =
		slugIdx >= 0 && segments.length > slugIdx + 1
			? decodeURIComponent(segments[slugIdx + 1])
			: null;

	if (tail === "new") {
		frappe.new_doc("Patient Encounter");
	} else if (tail) {
		frappe.set_route("Form", "Patient Encounter", tail);
	} else {
		frappe.set_route("List", "Patient Encounter");
	}
};
