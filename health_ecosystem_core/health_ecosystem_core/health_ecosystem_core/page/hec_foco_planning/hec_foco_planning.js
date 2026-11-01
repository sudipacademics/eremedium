frappe.pages["hec-foco-planning"].on_page_load = function (wrapper) {
	var page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("FOCO Sales-Channel Planning"),
		single_column: true,
	});
	wrapper.page = page;
	foco_planning.init(wrapper);
};

frappe.pages["hec-foco-planning"].on_page_show = function (wrapper) {
	if (wrapper && wrapper._foco_refresh) wrapper._foco_refresh();
};

var foco_planning = {
	api: "health_ecosystem_core.health_ecosystem_core.clinical_phase92_foco_planning",

	css: function () {
		return `<style>
			.fp-wrap { padding: 12px 4px 24px; max-width: 1200px; }
			.fp-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
				background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 18px; margin-bottom: 16px; }
			.fp-form label { font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 2px; display: block; }
			.fp-form input, .fp-form select { width: 100%; padding: 7px 10px; border: 1px solid #cbd5e1;
				border-radius: 6px; font-size: 13px; }
			.fp-form .fp-actions { grid-column: 1 / -1; display: flex; gap: 8px; margin-top: 6px; }
			.fp-list { margin-bottom: 20px; }
			.fp-list table { width: 100%; border-collapse: collapse; font-size: 13px; background: #fff; }
			.fp-list th, .fp-list td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
			.fp-list th { background: #f1f5f9; font-weight: 600; font-size: 12px; color: #334155; }
			.fp-list tr:hover { background: #f8fafc; }
			.fp-list .fp-link { color: #2563eb; cursor: pointer; text-decoration: underline; }
			.fp-detail { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; }
			.fp-detail-header { display: flex; justify-content: space-between; align-items: center;
				margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
			.fp-detail-header h3 { margin: 0; font-size: 18px; color: #0f172a; }
			.fp-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 11px;
				font-weight: 600; }
			.fp-badge-draft { background: #fef3c7; color: #92400e; }
			.fp-badge-planning { background: #dbeafe; color: #1e40af; }
			.fp-badge-ai { background: #d1fae5; color: #065f46; }
			.fp-badge-approved { background: #e0e7ff; color: #3730a3; }
			.fp-verticals { display: grid; gap: 16px; margin-top: 12px; }
			.fp-vert { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
			.fp-vert-head { background: #f8fafc; padding: 10px 14px; font-weight: 600; font-size: 14px;
				color: #1e293b; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px; }
			.fp-vert-body { display: grid; grid-template-columns: 1fr 1fr; }
			.fp-vert-col { padding: 12px 14px; }
			.fp-vert-col:first-child { border-right: 1px solid #e2e8f0; }
			.fp-vert-col label { font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase;
				letter-spacing: .5px; margin-bottom: 6px; display: block; }
			.fp-vert-col textarea { width: 100%; min-height: 100px; border: 1px solid #cbd5e1; border-radius: 6px;
				padding: 8px 10px; font-size: 13px; resize: vertical; font-family: inherit; }
			.fp-plan-text { white-space: pre-wrap; font-size: 13px; line-height: 1.6; color: #1e293b;
				min-height: 100px; }
			.fp-plan-text h1,.fp-plan-text h2,.fp-plan-text h3,.fp-plan-text h4 {
				font-size: 14px; font-weight: 700; margin: 10px 0 4px; }
			.fp-plan-text ul,.fp-plan-text ol { margin: 4px 0 4px 18px; }
			.fp-btn-ai { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border: none;
				padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;
				display: inline-flex; align-items: center; gap: 6px; }
			.fp-btn-ai:hover { opacity: 0.9; }
			.fp-btn-ai:disabled { opacity: 0.5; cursor: not-allowed; }
			.fp-spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.3);
				border-top-color: #fff; border-radius: 50%; animation: fp-spin 0.6s linear infinite; }
			@keyframes fp-spin { to { transform: rotate(360deg); } }
			.fp-empty { text-align: center; padding: 40px; color: #94a3b8; font-size: 14px; }
			.fp-back { cursor: pointer; color: #2563eb; font-size: 13px; margin-bottom: 12px; display: inline-block; }
			.fp-tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
			.fp-tab { padding: 8px 20px; font-size: 13px; font-weight: 600; color: #64748b; cursor: pointer;
				border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all .15s; }
			.fp-tab:hover { color: #1e293b; }
			.fp-tab.active { color: #2563eb; border-bottom-color: #2563eb; }
			.fp-tab-body { display: none; }
			.fp-tab-body.active { display: block; }
			.fp-ctx { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; }
			.fp-ctx-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
			.fp-ctx-header h4 { margin: 0; font-size: 15px; color: #1e293b; }
			.fp-ctx-desc { font-size: 12px; color: #64748b; margin-bottom: 14px; }
			.fp-ctx-upload { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
			.fp-ctx-upload input[type=file] { font-size: 12px; }
			.fp-ctx-files { display: grid; gap: 8px; }
			.fp-ctx-file { display: flex; align-items: center; justify-content: space-between;
				padding: 10px 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; }
			.fp-ctx-file-info { display: flex; align-items: center; gap: 10px; }
			.fp-ctx-file-icon { font-size: 20px; color: #6366f1; }
			.fp-ctx-file-name { font-size: 13px; font-weight: 500; color: #1e293b; }
			.fp-ctx-file-meta { font-size: 11px; color: #94a3b8; }
			.fp-ctx-file .btn-danger { font-size: 11px; padding: 2px 10px; }
			.fp-ctx-empty { text-align: center; padding: 30px; color: #94a3b8; font-size: 13px;
				border: 2px dashed #e2e8f0; border-radius: 8px; }
		</style>`;
	},

	init: function (wrapper) {
		var me = this;
		var $body = $(wrapper).find(".layout-main-section");
		if (!$body.length) $body = $(wrapper);
		$body.html(me.css() + '<div class="fp-wrap"><div class="fp-content"></div></div>');
		me.$content = $body.find(".fp-content");
		me.wrapper = wrapper;

		var page = wrapper.page;
		if (page && page.set_primary_action) {
			page.set_primary_action(__("New Plan"), function () {
				me.showCreate();
			}, "add");
		}
		wrapper._foco_refresh = function () { me.showList(); };
		me.showList();
	},

	call: function (method, args, callback) {
		frappe.call({
			method: this.api + "." + method,
			args: args || {},
			callback: function (r) { callback(r.message || {}); },
			error: function () { callback({ status: "error", message: "Request failed" }); },
		});
	},

	showList: function () {
		var me = this;
		me.$content.html('<p class="text-muted">Loading plans…</p>');
		me.call("list_plans", {}, function (r) {
			var plans = (r.data || []);
			if (!plans.length) {
				me.$content.html('<div class="fp-empty">No plans yet. Click <b>New Plan</b> to create one.</div>');
				return;
			}
			var rows = plans.map(function (p) {
				return '<tr>' +
					'<td><span class="fp-link" data-id="' + p.name + '">' + frappe.utils.escape_html(p.name) + '</span></td>' +
					'<td>' + frappe.utils.escape_html(p.target_area) + '</td>' +
					'<td>' + (p.foco_count || 0) + '</td>' +
					'<td>' + me.badgeHtml(p.status) + '</td>' +
					'<td>' + frappe.datetime.str_to_user(p.modified) + '</td>' +
					'<td><button class="btn btn-xs btn-danger fp-del" data-id="' + p.name + '">Delete</button></td>' +
					'</tr>';
			}).join("");
			me.$content.html(
				'<div class="fp-list"><table>' +
				'<thead><tr><th>ID</th><th>Area</th><th>FOCOs</th><th>Status</th><th>Modified</th><th></th></tr></thead>' +
				'<tbody>' + rows + '</tbody></table></div>'
			);
			me.$content.find(".fp-link").on("click", function () {
				me.showDetail($(this).data("id"));
			});
			me.$content.find(".fp-del").on("click", function (e) {
				e.stopPropagation();
				var id = $(this).data("id");
				frappe.confirm(__("Delete plan " + id + "?"), function () {
					me.call("delete_plan", { plan_id: id }, function () { me.showList(); });
				});
			});
		});
	},

	badgeHtml: function (status) {
		var cls = "fp-badge-draft";
		if (status === "Planning") cls = "fp-badge-planning";
		else if (status === "AI Generated") cls = "fp-badge-ai";
		else if (status === "Approved") cls = "fp-badge-approved";
		return '<span class="fp-badge ' + cls + '">' + frappe.utils.escape_html(status || "Draft") + '</span>';
	},

	showCreate: function () {
		var me = this;
		me.$content.html(
			'<span class="fp-back">&larr; Back to list</span>' +
			'<div class="fp-form">' +
			'<div><label>Target Area</label><input type="text" class="fp-area" placeholder="e.g. West Bardhaman"></div>' +
			'<div><label>Number of FOCOs</label><input type="number" class="fp-count" min="1" value="60"></div>' +
			'<div class="fp-actions">' +
			'<button class="btn btn-primary btn-sm fp-create-btn">Create Plan</button>' +
			'<button class="btn btn-default btn-sm fp-cancel-btn">Cancel</button>' +
			'</div></div>'
		);
		me.$content.find(".fp-back, .fp-cancel-btn").on("click", function () { me.showList(); });
		me.$content.find(".fp-create-btn").on("click", function () {
			var area = me.$content.find(".fp-area").val().trim();
			var count = me.$content.find(".fp-count").val();
			if (!area) { frappe.msgprint(__("Area is required")); return; }
			me.call("create_plan", { target_area: area, foco_count: count }, function (r) {
				if (r.status === "success") {
					frappe.show_alert({ message: r.message, indicator: "green" });
					me.showDetail(r.data.name);
				} else {
					frappe.msgprint(r.message || "Error");
				}
			});
		});
	},

	showDetail: function (planId) {
		var me = this;
		me.$content.html('<p class="text-muted">Loading plan…</p>');
		me.call("get_plan", { plan_id: planId }, function (r) {
			if (r.status !== "success") {
				frappe.msgprint(r.message || "Not found");
				me.showList();
				return;
			}
			var d = r.data;
			var verticals = d.verticals || [];
			var vertsHtml = verticals.map(function (v) {
				var planRendered = v.plan
					? me.renderMarkdown(v.plan)
					: '<span class="text-muted">Not yet generated</span>';
				return '<div class="fp-vert">' +
					'<div class="fp-vert-head">' + frappe.utils.escape_html(v.label) + '</div>' +
					'<div class="fp-vert-body">' +
					'<div class="fp-vert-col"><label>VP Guidance</label>' +
					'<textarea class="fp-guidance" data-key="' + v.key + '">' +
					frappe.utils.escape_html(v.guidance) + '</textarea></div>' +
					'<div class="fp-vert-col"><label>AI-Generated Plan</label>' +
					'<div class="fp-plan-text" data-key="' + v.key + '">' + planRendered + '</div></div>' +
					'</div></div>';
			}).join("");

			var ctxFiles = d.context_files_list || [];
			var ctxFilesHtml = ctxFiles.length
				? ctxFiles.map(function (cf) {
					return '<div class="fp-ctx-file">' +
						'<div class="fp-ctx-file-info">' +
						'<span class="fp-ctx-file-icon">&#128196;</span>' +
						'<div><div class="fp-ctx-file-name">' + frappe.utils.escape_html(cf.file_name) + '</div>' +
						'<div class="fp-ctx-file-meta">Added by ' + frappe.utils.escape_html(cf.added_by || '') +
						' on ' + frappe.utils.escape_html((cf.added_on || '').substring(0, 10)) + '</div></div></div>' +
						'<button class="btn btn-xs btn-danger fp-ctx-rm" data-url="' +
						frappe.utils.escape_html(cf.file_url) + '">Remove</button></div>';
				}).join("")
				: '<div class="fp-ctx-empty">No context files uploaded yet.<br>Upload FOCO feature documents, brochures, or specs to give the AI more context.</div>';

			me.$content.html(
				'<span class="fp-back">&larr; Back to list</span>' +
				'<div class="fp-detail">' +
				'<div class="fp-detail-header">' +
				'<h3>For <b>' + frappe.utils.escape_html(d.foco_count) + '</b> FOCOs in <b>' +
				frappe.utils.escape_html(d.target_area) + '</b></h3>' +
				'<div>' + me.badgeHtml(d.status) +
				' <select class="fp-status-sel" style="font-size:12px;padding:3px 8px;border-radius:4px;border:1px solid #cbd5e1;margin-left:6px;">' +
				'<option' + (d.status === "Draft" ? " selected" : "") + '>Draft</option>' +
				'<option' + (d.status === "Planning" ? " selected" : "") + '>Planning</option>' +
				'<option' + (d.status === "AI Generated" ? " selected" : "") + '>AI Generated</option>' +
				'<option' + (d.status === "Approved" ? " selected" : "") + '>Approved</option>' +
				'</select></div></div>' +

				'<div class="fp-tabs">' +
				'<div class="fp-tab active" data-tab="plans">Departmental Plans</div>' +
				'<div class="fp-tab" data-tab="context">AI Context (' + ctxFiles.length + ' files)</div>' +
				'</div>' +

				'<div class="fp-tab-body active" data-tab="plans">' +
				'<div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">' +
				'<button class="fp-btn-ai fp-gen-btn"><span class="fp-btn-icon">&#9733;</span> Generate Plans with AI</button>' +
				'<button class="btn btn-default btn-sm fp-save-btn">Save Guidance</button>' +
				'</div>' +
				'<div class="fp-verticals">' + vertsHtml + '</div>' +
				'</div>' +

				'<div class="fp-tab-body" data-tab="context">' +
				'<div class="fp-ctx">' +
				'<div class="fp-ctx-header"><h4>FOCO Context Documents</h4></div>' +
				'<div class="fp-ctx-desc">Upload files describing your FOCO features, service offerings, pricing, ' +
				'brochures, or any reference material. The AI will read these files and use them to generate ' +
				'more specific and relevant departmental plans.</div>' +
				'<div class="fp-ctx-upload">' +
				'<input type="file" class="fp-ctx-file-input" accept=".pdf,.txt,.csv,.md,.json,.doc,.docx,.xls,.xlsx">' +
				'<button class="btn btn-primary btn-sm fp-ctx-upload-btn">Upload</button>' +
				'</div>' +
				'<div class="fp-ctx-files">' + ctxFilesHtml + '</div>' +
				'</div></div>' +

				'</div>'
			);

			me.$content.find(".fp-back").on("click", function () { me.showList(); });

			// Tab switching
			me.$content.find(".fp-tab").on("click", function () {
				var tab = $(this).data("tab");
				me.$content.find(".fp-tab").removeClass("active");
				$(this).addClass("active");
				me.$content.find(".fp-tab-body").removeClass("active");
				me.$content.find('.fp-tab-body[data-tab="' + tab + '"]').addClass("active");
			});

			// Context file upload — use Frappe's standard uploader then attach
			me.$content.find(".fp-ctx-upload-btn").on("click", function () {
				var fileInput = me.$content.find(".fp-ctx-file-input")[0];
				if (!fileInput.files || !fileInput.files.length) {
					frappe.msgprint(__("Please select a file"));
					return;
				}
				var $btn = $(this);
				$btn.prop("disabled", true).text("Uploading…");
				var file = fileInput.files[0];
				var fd = new FormData();
				fd.append("file", file, file.name);
				fd.append("is_private", 1);
				fd.append("doctype", "HEC FOCO Channel Plan");
				fd.append("docname", planId);
				$.ajax({
					url: "/api/method/upload_file",
					type: "POST",
					data: fd,
					processData: false,
					contentType: false,
					headers: { "X-Frappe-CSRF-Token": frappe.csrf_token },
					success: function (r) {
						var fileDoc = (r.message || {});
						if (fileDoc.file_url) {
							me.call("attach_context_file", {
								plan_id: planId,
								file_url: fileDoc.file_url,
								file_name: fileDoc.file_name || file.name,
							}, function (r2) {
								if (r2.status === "success") {
									frappe.show_alert({ message: "File uploaded & attached", indicator: "green" });
									me.showDetail(planId);
								} else {
									frappe.msgprint(r2.message || "Attach failed");
									$btn.prop("disabled", false).text("Upload");
								}
							});
						} else {
							frappe.msgprint("Upload failed — no file URL returned");
							$btn.prop("disabled", false).text("Upload");
						}
					},
					error: function () {
						frappe.msgprint("Upload failed");
						$btn.prop("disabled", false).text("Upload");
					},
				});
			});

			// Context file remove
			me.$content.find(".fp-ctx-rm").on("click", function () {
				var url = $(this).data("url");
				frappe.confirm(__("Remove this context file?"), function () {
					me.call("remove_context_file", { plan_id: planId, file_url: url }, function (r2) {
						if (r2.status === "success") {
							frappe.show_alert({ message: "File removed", indicator: "green" });
							me.showDetail(planId);
						} else {
							frappe.msgprint(r2.message || "Error");
						}
					});
				});
			});

			me.$content.find(".fp-save-btn").on("click", function () {
				var args = { plan_id: planId, status: me.$content.find(".fp-status-sel").val() };
				me.$content.find(".fp-guidance").each(function () {
					args["guidance_" + $(this).data("key")] = $(this).val();
				});
				me.call("update_plan", args, function (r2) {
					if (r2.status === "success") {
						frappe.show_alert({ message: "Guidance saved", indicator: "green" });
					} else {
						frappe.msgprint(r2.message || "Error");
					}
				});
			});

			me.$content.find(".fp-status-sel").on("change", function () {
				me.call("update_plan", { plan_id: planId, status: $(this).val() }, function (r2) {
					if (r2.status === "success")
						frappe.show_alert({ message: "Status updated", indicator: "green" });
				});
			});

			me.$content.find(".fp-gen-btn").on("click", function () {
				var $btn = $(this);
				$btn.prop("disabled", true).html('<span class="fp-spinner"></span> Generating…');
				var args = { plan_id: planId };
				me.$content.find(".fp-guidance").each(function () {
					args["guidance_" + $(this).data("key")] = $(this).val();
				});
				me.call("update_plan", args, function () {
					me.call("generate_ai_plan", { plan_id: planId }, function (r2) {
						if (r2.status === "success") {
							frappe.show_alert({ message: "AI plans generated!", indicator: "green" });
							me.showDetail(planId);
						} else {
							frappe.msgprint(r2.message || "AI generation failed");
							$btn.prop("disabled", false).html('<span class="fp-btn-icon">&#9733;</span> Generate Plans with AI');
						}
					});
				});
			});
		});
	},

	renderMarkdown: function (text) {
		if (!text) return "";
		var html = frappe.utils.escape_html(text);
		html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
		html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
		html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
		html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
		html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
		html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
		html = html.replace(/<\/ul>\s*<ul>/g, '');
		html = html.replace(/\n/g, '<br>');
		return html;
	},
};
