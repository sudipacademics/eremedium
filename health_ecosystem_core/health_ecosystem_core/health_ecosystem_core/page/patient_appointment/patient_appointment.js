frappe.pages["patient-appointment"].on_page_load = function () {
	var path = window.location.pathname || "";
	var segments = path.split("/").filter(Boolean);
	var slugIdx = segments.indexOf("patient-appointment");
	var tail =
		slugIdx >= 0 && segments.length > slugIdx + 1
			? decodeURIComponent(segments[slugIdx + 1])
			: null;

	if (tail === "new") {
		frappe.new_doc("Patient Appointment");
	} else if (tail) {
		frappe.set_route("Form", "Patient Appointment", tail);
	} else {
		frappe.set_route("List", "Patient Appointment");
	}
};
