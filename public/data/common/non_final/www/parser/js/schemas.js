
"use strict";

var g_Structures = {};
var g_StructdefSchemaTableTemplate;

// Set up some handlebars helpers as soon as the page loads
$(document).ready(function() {
	Handlebars.registerHelper('ifEq', function(a, b, options) {
		if (a === b) {
			return options.fn(this);
		}
		return options.inverse(this);
	});

	Handlebars.registerHelper('toHex', function(item) {
		return "0x" + item.toString("16");
	});

	g_StructdefSchemaTableTemplate = Handlebars.compile($('#structdefSchemaTable-template').html());
});

function sortWithKey(sortKeyFn) {
	return function(a, b) {
		var aval = sortKeyFn(a),
			bval = sortKeyFn(b);
		if (aval < bval) { return -1; }
		if (aval > bval) { return 1; }
		return 0;
	};
}

function getStdInt(xml, name) {
	return parseInt($(xml).find(name + ":first").attr("value"), 10);
}

function getStdString(xml, name) { 
	return $(xml).find(name + ":first").text();
}

function getMemberList(xml) {
	var base = $(xml).find("> parStructure > Base").attr("ref"),
		baseMembers = [];
	if (base && base !== "NULL") {
		$.ajax({
		url:"/Parser/Schema/" + base,
		dataType:"xml",
		async: false,
		success: function (baseXml, status, jqXHR) {
			baseMembers = getMemberList(baseXml);
		}
		});
	}
	return $("> parStructure > Members > Item", xml).get().concat(baseMembers);
}

function getFriendlyTypeName(xml) {
	var type = getStdString(xml, "> Data > Type"),
		subtype = getStdString(xml, "> Data > Subtype"),
		refType, keyType, valType, enumName;
	switch(type) {
		case "BOOL": return "bool";
		case "CHAR": return "char";
		case "UCHAR": return "u8";
		case "SHORT": return "s16";
		case "USHORT": return "u16";
		case "INT": return "int";
		case "UINT": return "u32";
		case "FLOAT": return "float";
		case "VECTOR2": return "Vector2";
		case "VECTOR3": return "Vector3";
		case "VECTOR4": return "Vector4";
		case "STRING":
			switch (subtype) {
				case "MEMBER": return "char[]";
				case "POINTER": return "char*";
				case "CONST_STRING": return "ConstString";
				case "ATSTRING": return "atString";
				case "WIDE_MEMBER": return "char16[]";
				case "WIDE_POINTER": return "char16*";
				case "ATWIDESTRING": return "atWideString";
				case "ATNONFINALHASHSTRING": return "atNonFinalHashString";
				case "ATFINALHASHSTRING": return "atFinalHashString";
				case "ATHASHVALUE": return "atHashValue";
			}
			break;
		case "STRUCT":
			switch (subtype) {
				case "STRUCTURE": return $(xml).find("> Data > StructurePtr").attr("ref");
				case "EXTERNAL_NAMED": return "void* (external)";
				case "EXTERNAL_NAMED_USERNULL": return "void* (external)";
				case "POINTER": 
				case "SIMPLE_POINTER":
					return $(xml).find("> Data > StructurePtr").attr("ref") + "*";
				case "LINK_IMMEDIATE": return "parLink";
				case "LINK_LAZY": return "parLinkLazy";
			}
			break;
		case "ARRAY":
			refType = getFriendlyTypeName($(xml).find("> PrototypeMember"));
			switch (subtype) {
				case "ATARRAY": return "atArray< " + refType + " >";
				case "ATFIXEDARRAY": return "atFixedArray< " + refType + ", " + getStdInt(xml, "> Data > NumElements") + " >";
				case "ATRANGEARRAY": return "atRangeArray< " + refType + ", " + getStdInt(xml, "> Data > NumElements") + " >";
				case "POINTER": 
				case "POINTER_WITH_COUNT":
				case "POINTER_WITH_COUNT_8BIT_IDX":
				case "POINTER_WITH_COUNT_16BIT_IDX":
					return refType + "* (array)";
				case "MEMBER": return refType + "[" + getStdInt(xml, "> Data > NumElements") + "]";
				case "STL_VECTOR": return "std::vector"; // shouldn't get here
				case "ATARRAY_8BIT_INDEX": return "atArray< " + refType + ", u8 >";
				case "ATARRAY_32BIT_INDEX": return "atArray< " + refType + ", u32 >";
			}
			break;
		case "ENUM": return "enum " + getStdString(xml, "> Data > Name");
		case "BITSET":
			enumName = "bitset " + (getStdString(xml, "> Data > Name") || "(unnamed)") + " (" + getStdInt(xml, "> Data > NumBits") + " bits)";
			break;
		case "MAP":
			keyType = getFriendlyTypeName($(xml).find("> KeyParMember"));
			valType = getFriendlyTypeName($(xml).find("> DataParMember"));
			switch (subtype) {
				case "ATMAP": return "atMap< " + keyType + " , " + valType + " >";
				case "ATBINARYMAP": return "atBinaryMap< " + valType + ", " + keyType + " >";
			}
			break;
		case "MATRIX34": return "Matrix34";
		case "MATRIX44": return "Matrix44";
		case "VEC2V": return "Vec2V";
		case "VEC3V": return "Vec3V";
		case "VEC4V": return "Vec4V";
		case "MAT33V": return "Mat33V";
		case "MAT34V": return "Mat34V";
		case "MAT44V": return "Mat44V";
		case "SCALARV": return "ScalarV";
		case "BOOLV": return "BoolV";
		case "VECBOOLV": return "VecBoolV";
		case "PTRDIFFT": return "ptrdiff_t";
		case "SIZET": return "size_t";
		case "FLOAT16": return "Float16";
		case "S64": return "s64";
		case "U64": return "u64";
		case "DOUBLE": return "double";
	}
	return "unknown";
}

function getLinkDestination(xml) {
	if (!xml) {
		return null;
	}

	var type = getStdString(xml, "> Data > Type"),
		subtype = getStdString(xml, "> Data > Subtype");
		
	if (type === "STRUCT" && subtype === "STRUCTURE") {
		return "/Parser/Schema/" + $(xml).find("> Data > StructurePtr").attr("ref");
	}
	if (type === "ARRAY") {
		switch (subtype) {
			case "ATFIXEDARRAY": 
			case "ATRANGEARRAY": 
			case "MEMBER": 
				return getLinkDestination($(xml).find("> PrototypeMember"));
		}
	}
	return null;
}

function generateStructTableHtml(data) {
	var members,
		spans, newSpans, span, dispSpan,
		i, lastOffset,
		startRow, endRow, namedRow, row,
		title, link,
		roundUp,
		structData = {
			name: $("Name:first", data).text(),
			totalSize: getStdInt(data, "Size"),
			rows: []
		};

	members = getMemberList(data);
	
	// Build the initial span objects
	spans = members.map(function(mem) {
		span = {
			name: getStdString(mem, "> Data > Name"),
			start: getStdInt(mem, "> Data > Offset"),
			type: getStdString(mem, "> Data > Type"),
			subtype: getStdString(mem, "> Data > Subtype"),
			size: getStdInt(mem, "> ComputedSize"),
			xml: mem
		};
		span.end = span.start + span.size;
		return span;
	});
	
	spans.sort(sortWithKey(function(x) { return x.start; }));

	// Add padding spans
	lastOffset = 0;
	i = 0;
	newSpans = [];
	while(i < spans.length) {
		if (lastOffset < spans[i].start) {
			newSpans.push({name:"", start: lastOffset, type: "PADDING", subtype: "", size: spans[i].start - lastOffset, end: spans[i].start});
		}
		newSpans.push(spans[i]);
		lastOffset = spans[i].end;
		i++;
	}
	if (lastOffset < structData.totalSize) {
		newSpans.push({name:"", start: lastOffset, type: "PADDING", size: structData.totalSize - lastOffset, end: structData.totalSize});
	}
	if (structData.totalSize % 16 > 0) {
		roundUp = Math.floor((structData.totalSize + 15)/16) * 16;
		newSpans.push({name:"", start: structData.totalSize, type: "ENDOFSTRUCT", size: roundUp - structData.totalSize, end: roundUp});
	}
	
	spans = newSpans;

	for(i = 0; i < Math.ceil(structData.totalSize / 16); i++) {
		structData.rows[i] = {
			rowAddr: i * 16,
			spans: []
		};
	}
	
	// Now create display spans that go in the appropriate rows, and with the appropriate tags
	for(i = 0; i < spans.length; i++) {
		span = spans[i];
		startRow = Math.floor(span.start / 16);
		endRow = Math.floor((span.end-1) / 16);
		namedRow = Math.floor((startRow + endRow)/2);
		
		title = "";
		if (span.type === "ENDOFSTRUCT") { title = ""; }
		else {
			if (span.type === "PADDING" ) {
				if (span.start === 0 && span.end >= 8) { 
					title = "padding (vptr?)"; 
				}
				else { 
					title = "padding"; 
				}
			}	
			else {
				title = getFriendlyTypeName(span.xml);
			}
			if (span.size === 1) {
				title += " byte " + span.start;
			}
			else {
				title += " bytes " + span.start + " - " + (span.end-1);
			}
		}
		
		link = getLinkDestination(span.xml);
		
		row = startRow;
		do {
			// Push a copy of span i
			dispSpan = {
				name: (row === namedRow) ? span.name : "",
				spanStart: Math.max(span.start, row*16),
				realStart: span.start,
				type: span.type,
				subtype: span.subtype,
				size: span.size,
				spanEnd: Math.min(span.end, (row+1)*16), 
				realEnd: span.end,
				title: title,
				link: link
			};
			dispSpan.colStart = dispSpan.spanStart % 16;
			dispSpan.colEnd = (dispSpan.spanEnd - 1) % 16;
			dispSpan.numColumns = dispSpan.spanEnd - dispSpan.spanStart;

			structData.rows[row].spans.push(dispSpan);
			
			row++;
		} while(row <= endRow);
	}
	
	// Build out the template, and add it to the drawing area
	$("#drawingArea").prepend(g_StructdefSchemaTableTemplate(structData));
}

function displayNewType(href) {
	$.ajax({
		url:href,
		dataType:"xml",
		success: function (xml, status, jqXHR) {
			// Am I dealing with a structdef or an enumdef?
			switch(xml.documentElement.localName) {
			case "parStructure":
				generateStructTableHtml(xml);
				break;
			case "parEnumDef":
				//TODO: generateEnumTableHtml(xml);
				break;
			}
		}
	});
}

function populateIndexRec(currNode) {
	var nodeList = g_Structures[currNode].derived,
		i, nodeI,
		newHtml;
	nodeList.sort(sortWithKey(function(x) { return x.toLowerCase(); }));
	newHtml = "<ul>";
	for(i in nodeList) {
		nodeI = nodeList[i];
		newHtml += "<li><a href='/Parser/Schema/" + nodeI + "' class='schemaLink'>" + nodeI + "</a></li>";
		if (g_Structures[nodeI].derived.length > 0) {
			newHtml += populateIndexRec(nodeI);
		}
	}
	newHtml += "</ul>";
	return newHtml;
}

function populateIndex() {
	$.ajax({
		url:"/Parser/Schema",
		dataType:"xml",
		success: function(xml, status, jqXHR) {
			var dataList = "", structure, name, newHtml;
			
			g_Structures["__root__"] = {name: "__root__", base: undefined, size: undefined, derived: []};
			
			$(xml).find("Schemas Structures Item").each(function(index) {
				var jqthis = $(this),
					name = jqthis.find("Name").text(),
					base = jqthis.find("Base").text() || "__root__",
					size = getStdInt(jqthis, "Size");
				
				g_Structures[name] = {name: name, base: base, size: size, derived: []};
			});
			
			for(name in g_Structures) {
				structure = g_Structures[name];
				dataList += "<option>" + structure.name + "</option>";
				if (structure.base) {
					g_Structures[structure.base].derived.push(structure.name);
				}
			}
			
			// Now starting at __root__ generate a list of all nodes (recursively)
			newHtml = populateIndexRec("__root__");
			
			$("#schemaList").html(newHtml);
			$("#datalistSchemas").html(
			"<!--[if IE 9]><select disabled style=\"display:none\"><![endif]-->" +
			dataList +
			"<!--[if IE 9]></select><![endif]-->"
			);
		}
	});
}

////////////////////////////////////////////////////////////////////
// Global script bindings

$("#classNameInput").change(function() {
	displayNewType("/Parser/Schema/" + this.value);
	return false;
});

$("#schemaList, #drawingArea").on("click", "a.schemaLink", function() { // binds to any <a> children of #schemaList, now or in the future
	displayNewType(this.href);
	return false; // stop event processing
});

$("#drawingArea").on("click", "a.closeSchema", function() { 
	$(this).parents("table.schema").fadeOut(200, function() { $(this).remove(); });
});

$("#clearDrawingArea").click(function() {
	$("#drawingArea").empty();
	return false;
});

$(document).ready(populateIndex);


