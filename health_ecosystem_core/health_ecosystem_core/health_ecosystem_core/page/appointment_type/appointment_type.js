frappe.pages["appointment-type"].on_page_load = function () {
	var path = window.location.pathname || "";
	var segments = path.split("/").filter(Boolean);
	var slugIdx = segments.indexOf("appointment-type");
	var tail =
		slugIdx >= 0 && segments.length > slugIdx + 1
			? decodeURIComponent(segments[slugIdx + 1])
			: null;

	if (tail === "new") {
		frappe.new_doc("Appointment Type");
	} else if (tail) {
		frappe.set_route("Form", "Appointment Type", tail);
	} else {
		frappe.set_route("List", "Appointment Type");
	}
};
