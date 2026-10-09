
"use strict";

var g_PsoSchemas = {},
	g_CppSchemas = {},
	g_CurrFilename = "",
	g_CurrClassname = "";

var populateFileList = function populateFileList() {
	$.getJSON("/Parser/PsoMismatch/FileSchemas", null, function gotFileList(data, status, jqXHR) {
		var menu = $("#mismatchingFiles");
		var vmDataList = $.map(data, function(elt, idx) {
			return {"filename": elt, "url": "/Parser/PsoMismatch/FileSchemas/" + elt};
		});
		var html = g_Handlebars["mismatchListTemplate"]({items: vmDataList});
		menu.html(html);
	});
};

var makeSchemaDataViewModel = function makeSchemaDataViewModel(psoData) {
	var vm = {"structs": {}, "enums": {}};

	// Right now, just convert the arrays to hashes
	$.each(psoData.schemas, function(idx, elt) {
		vm.structs[elt.nameHash] = elt;
	});
	
	vm.structsSortedByName = psoData.schemas.sort(sortWithKey(function(x) { return x.name || x.nameHash; }));
	
	$.each(psoData.enums, function(idx, elt) {
		vm.enums[elt.nameHash] = elt;
	});

	vm.enumsSortedByName = psoData.enums.sort(sortWithKey(function(x) { return x.name || x.nameHash; }));

	return vm;
}

var highlightMismatches = function highlightMismatches(psoData, cppData) {
	$.each(psoData.structs, function(idx, elt) {
		var psoSchema = elt,
			match = true,
			cppSchema = cppData.structs[idx],
			link;

		if (!cppSchema) {
			match = false;
		}
		else {
			if (psoSchema.signature !== cppSchema.signature) {
				match = false;
			}	
		}
		
		link = $(".structSchemaName[data-nameHash='" + psoSchema.nameHash + "'");
		link.removeClass("compareUnknown");
		link.addClass(match ? "compareMatch" : "compareMismatch");
	});
	
	$("#initialStatus").hide();
	$("#foundCppStatus").show();
	
};

var displayFileSchemasAndEnums = function displayFileSchemasAndEnums(url) {
	$.getJSON(url, {"source": "PSO"}, function gotPSO(psoData, status, jqxhr) {
	
		g_PsoSchemas = makeSchemaDataViewModel(psoData);

		var html = g_Handlebars["schemasInPsoTemplate"](g_PsoSchemas);
		$("#schemasInFile").html(html);
		
		// Kick off another request to get the CPP version of the data, when it comes back, start comparing
		$.getJSON(url, {"source": "CPP"}, function gotCPP(cppData, status, jqxhr) {
			g_CppSchemas = makeSchemaDataViewModel(cppData);
			highlightMismatches(g_PsoSchemas, g_CppSchemas);
		});
	});
};

var findMemberSchemaMismatches = function findMemberSchemaMismatches(refMember, refSchema, refFile, member, schema, file) 
{
	var refReferentStruct, referentStruct,
		refReferentEnum, referentEnum;

	if (refMember.nameHash !== member.nameHash) {
		member.nameMismatch = "mismatch";
	}
	if (refMember.offset !== member.offset) {
		member.offsetMismatch = "mismatch";
	}
	if (refMember.type !== member.type) {
		member.typeMismatch = "mismatch";
	}
	if (typeof refMember.referentStructureHash !== "undefined" && refMember.referentStructureHash !== member.referentStructureHash) {
		member.referentStructureMismatch = "mismatch";
	}
	if (typeof refMember.referentEnumHash !== "undefined" && refMember.referentEnumHash !== member.referentEnumHash) {
		member.referentEnumMismatch = "mismatch";
	}
	if (typeof refMember.arrayContentsIndex !== "undefined" && refMember.arrayContentsIndex !== member.arrayContentsIndex) {
		member.arrayContentxIdxMismatch = "mismatch";
	}
	if (typeof refMember.arrayContentsAlignment !== "undefined" && refMember.arrayContentsAlignment != member.arrayContentsAlignment) {
		member.arrayContentsAlignMismatch = "mismatch";
	}
	if (typeof refMember.maxArrayCount !== "undefined" && refMember.maxArrayCount !== member.maxArrayCount) {
		member.maxArrayCountMismatch = "mismatch";
	}
	if (typeof refMember.arrayCounterIndex !== "undefined" && refMember.arrayCounterIndex !== member.arrayCounterIndex) {
		member.arrayCounterMismatch = "mismatch";
	}
	if (typeof refMember.bitsetNamesEnumHash !== "undefined" && refMember.bitsetNamesEnumHash !== member.bitsetNamesEnumHash) {
		member.bitsetNamesMismatch = "mismatch";
	}
	if (typeof refMember.bitsetCount !== "undefined" && refMember.bitsetCount !== member.bitsetCount) {
		member.bitsetCountMismatch = "mismatch";
	}
	if (typeof refMember.stringCount !== "undefined" && refMember.stringCount !== member.stringCount) {
		member.stringCountMismatch = "mismatch";
	}
	if (typeof refMember.stringNamespace !== "undefined" && refMember.stringNamespace !== member.stringNamespace) {
		member.stringNamespaceMismatch = "mismatch";
	}
	if (typeof refMember.keyIndex !== "undefined" && refMember.keyIndex !== member.keyIndex) {
		member.keyIndexMismatch = "mismatch";
	}
	if (typeof refMember.valueIndex !== "undefined" && refMember.valueIndex !== member.valueIndex) {
		member.valueIndexMismatch = "mismatch";
	}
	
	if (refMember.typeName === "STRUCT") {
		refReferentStruct = refFile.structs[refMember.referentStructureHash];
		referentStruct = file.structs[member.referentStructureHash];
		if (refReferentStruct.signature !== referentStruct.signature) {
			member.referentStructureMismatch = "mismatch";
		}
	}
	if (typeof refMember.referentEnumHash !== "undefined" && refMember.referentEnumHash > 4096) {
		refReferentEnum = refFile.enums[refMember.referentEnumHash];
		referentEnum = refFile.enums[member.referentEnumHash];
		if (refReferentEnum.signature !== referentEnum.signature) {
			member.referentEnumMismatch = "mismatch";
		}
	}
	
	if (refMember.typeName === "ARRAY_MEMBER" || refMember.typeName === "ATFIXEDARRAY") {
		findMemberSchemaMismatches(refSchema.members[refMember.arrayContentxIndex], refSchema, refFile,
									schema.members[member.arrayContentxIndex], schema, file);
	}
	
	
}

var findStructSchemaMismatches = function findStructSchemaMismatches(refSchema, refFile, schema, file)
{
	// Mark up all the places where 'schema' doesn't match 'refSchema'
	
	if (refSchema.signature !== schema.signature) {
		schema.sigMismatch = "mismatch";
	}
	/* flags are just for runtime use for now, don't highlight them 
	if (refSchema.flags !== schema.flags) {
		schema.flagsMismatch = "mismatch";
	}
	*/
	if (refSchema.alignment !== schema.alignment) {
		schema.alignMismatch = "mismatch";
	}
	if (refSchema.size !== schema.size) {
		schema.sizeMismatch = "mismatch";
	}
	if (refSchema.version !== schema.version) {
		schema.versionMismatch = "mismatch";
	}
	
	while (refSchema.members.length > schema.members.length) {
		schema.members.push({"indexMismatch": "mismatch"}); // pad out the schema as needed
	}
	
	var numMembers = schema.members.length;
	for(var i = 0; i < numMembers; i++)
	{
		var refMember = refSchema.members[i];
		var member = schema.members[i];
		
		if (refMember.hashType === "named") {
			findMemberSchemaMismatches(refMember, refSchema, refFile, member, schema, file);
		}
	}
}


var displayStructSchemaComparison = function displayStructSchemaComparison(id) {
	var psoSchema = findElementInCollectionWithKey(g_PsoSchemas.structs, "nameHash", id),
		cppSchema = findElementInCollectionWithKey(g_CppSchemas.structs, "nameHash", id),
		tableHtml;
	
	var htmlStr = g_Handlebars["structSchemaComparison"](
		{
			"filename": g_CurrFilename, 
			"classname": g_CurrClassname
		}
		);
	var comparisonDivHtml = $.parseHTML(htmlStr);
	
	findStructSchemaMismatches(cppSchema, g_CppSchemas, psoSchema, g_PsoSchemas);
	
	if (cppSchema)
	{
		cppSchema["source"] = "Runtime";
		cppSchema["class"] = "structSchemaCpp";
		tableHtml = $.parseHTML(g_Handlebars["structSchemaDetail"](cppSchema));
		$(comparisonDivHtml, "#structSchemas").append(tableHtml);
	}
	
	if (psoSchema)
	{
		psoSchema["source"] = "PSO File";
		psoSchema["class"] = "structSchemaPso";
		tableHtml = $.parseHTML(g_Handlebars["structSchemaDetail"](psoSchema));
		$(comparisonDivHtml, "#structSchemas").append(tableHtml);
	}

	$("#drawingArea").prepend(comparisonDivHtml);

};

var handleChooseStructSchema = function handleChooseStructSchema() { // Binds to any <a> child of #schemasInFile, now or in the future
	g_CurrClassname = this.text;
	var intId = parseInt(this.getAttribute('data-namehash'));
	displayStructSchemaComparison(intId);
	return false;
}

////////////////////////////////////////////////////////////////////
// Global script bindings

$("#menu").on("click", "a.mismatchFileLink", function handleChooseFile() { // Binds to any <a> children of #menu, which have class .mismatchFileLink, now or in the future
	g_CurrFilename = this.text;
	displayFileSchemasAndEnums(this.href);
	return false; // stop event processing
});
	
$("#schemasInFile").on("click", "a.structSchemaName", handleChooseStructSchema);
$("#drawingArea").on("click", "a.structSchemaName", handleChooseStructSchema);

$("#clearDrawingArea").click(function() {
	$("#drawingArea").empty();
	return false;
});

$(document).ready(populateFileList);


