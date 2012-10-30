/*******************************************************************************
 * @license
 * Copyright (c) 2012 VMware, Inc. All Rights Reserved.
 * THIS FILE IS PROVIDED UNDER THE TERMS OF THE ECLIPSE PUBLIC LICENSE
 * ("AGREEMENT"). ANY USE, REPRODUCTION OR DISTRIBUTION OF THIS FILE
 * CONSTITUTES RECIPIENTS ACCEPTANCE OF THE AGREEMENT.
 * You can obtain a current copy of the Eclipse Public License from
 * http://www.opensource.org/licenses/eclipse-1.0.php
 *
 * Contributors:
 *     Chris Johnson - initial implementation
 *      Andy Clement
 *    Andrew Eisenberg - refactoring for a more consistent approach to navigation
 ******************************************************************************/

/*jslint browser:true */
/*global window setTimeout define explorer document console location XMLHttpRequest alert confirm orion scripted dojo $ localStorage*/
define(["scripted/editor/scriptedEditor", "orion/textview/keyBinding", "orion/searchClient", "scripted/widgets/OpenResourceDialog", "scripted/widgets/OpenOutlineDialog",
"scripted/fileSearchClient", "scripted/widgets/SearchDialog", "scripted/utils/os"], 
function(mEditor, mKeyBinding, mSearchClient, mOpenResourceDialog, mOpenOutlineDialog,
	mFileSearchClient, mSearchDialog, mOsUtils) {
	
	var EDITOR_TARGET = {
		main : "main",
		sub : "sub",
		tab : "tab"
	};
	var LINE_SCROLL_OFFSET = 5;
	
	// define as forward reference
	var navigate;
	
	var findTarget = function(event) {
		var target;
		if (mOsUtils.isCtrlOrMeta(event)) {
			target = EDITOR_TARGET.tab;
		} else {
			var subNavigationDisabled = (window.editor.loadResponse === 'error') ? true : false;
			target = (event.shiftKey || event.makeShift) && !subNavigationDisabled ? EDITOR_TARGET.sub : EDITOR_TARGET.main;
		}
		return target;
	};

	
	var close_side = function(editor) {
		$('#side_panel').hide();
		$('#editor').css('margin-right', '0');
		editor._textView._updatePage();
		$('#side_panel').trigger('close');
	};
	
	var open_side = function(editor) {
		if ( $('#side_panel').css('display') === 'block') { return false; }
		$('#side_panel').show();
		$('#editor').css('margin-right', $('#side_panel').width());
		editor._textView._updatePage();
		$('#side_panel').trigger('open');
	};
	
	var scrollToSelection = function(editor) {
		var tv = editor.getTextView();
		var model = tv.getModel();
		var offset = tv.getCaretOffset();
		var line = model.getLineAtOffset(offset);
		if (line >= LINE_SCROLL_OFFSET) {
			line = line - LINE_SCROLL_OFFSET;
		}
		tv.setTopIndex(line);
	};

	/**
	 * Retrieves the history from local storage
	 * @return {Array.<{filename:string,filepath:string,range:Array.<Number>,posiiion,url:string}>}
	 */
	var getHistory = function() {
		var historyJSON = localStorage.getItem("scriptedHistory");
		if (!historyJSON) {
			historyJSON = "[]";
		}
		return JSON.parse(historyJSON);
	};
	
	var getHistoryAsObject = function() {
		var histArr = getHistory();
		var histObj = {};
		for (var i = 0; i < histArr.length; i++) {
			histObj[histArr[i].filepath] = histArr[i];
		}
		return histObj;
	};
	
	var setHistory = function(history) {
		localStorage.setItem("scriptedHistory", JSON.stringify(history));
	};
	
	
	/**
	 * generates an item to be stored in scriptedHistory as well as browser state
	 */
	var generateHistoryItem = function(editor) {
		var filepath = editor.getFilePath();
		var scrollPos = $(editor._domNode).find('.textview').scrollTop();
		var selection = editor.getSelection();
		var url = window.location.pathname + '?' + filepath + "#" + selection.start + "," + selection.end;
		return {
			filename: filepath.split('/').pop(),
			filepath: filepath,
			range: [selection.start, selection.end],
			position: scrollPos,
			url: url
		};
	};
	
	
	var storeScriptedHistory = function(histItem) {
		var scriptedHistory = getHistory();
		for (var i = 0; i < scriptedHistory.length; i++) {
			if (scriptedHistory[i].filepath === histItem.filepath) {
				scriptedHistory.splice(i,1);
			}
		}
		scriptedHistory.push(histItem);
		
		// arbitrarily keep track of 8 scriptedHistory items
		// TODO should we have a .scripted setting to customize this?
		while (scriptedHistory.length > 8) {
			scriptedHistory.shift();
		}
		
		setHistory(scriptedHistory);
	};
	
	var storeBrowserState = function(histItem, doReplace) {
		try {
			if (doReplace) {
				window.history.replaceState(histItem, histItem.filename, histItem.url);
			} else {
				window.history.pushState(histItem, histItem.filename, histItem.url);
			}
		} catch (e) {
			console.log(e);
		}
	};
		
	var isBinary = function(filepath) {
		try {
			var xhrobj = new XMLHttpRequest();
			var url = 'http://localhost:7261/get?file=' + filepath;
			xhrobj.open("GET", url, false); // synchronous xhr
			xhrobj.send();
			if (xhrobj.readyState === 4) {
				if (xhrobj.status === 204 || xhrobj.status === 1223) { //IE9 turns '204' status codes into '1223'...
					return true;
				} else {
					return false;
				}
			}
		} catch (e) {
			console.log(filepath);
			console.log(e);
			return true;
		}
		return false;
	};


	/*
		This handles navigations from
			-Navigator
			-Breadcrumb
			-Open File
	*/
	var navigationEventHandler = function(event, editor) {
		var filepath = event.testTarget ? event.testTarget : (
			event.altTarget ? $(event.altTarget).attr('href') : $(event.currentTarget).attr('href'));
		var query_index = filepath.indexOf('?');
		if (query_index !== -1) {
			filepath = filepath.substring(query_index+1, filepath.length);
		}
		
		var hashIndex = filepath.indexOf('#');
		var range;
		if (hashIndex !== -1) {
			try {
				range = JSON.parse("[" + filepath.substring(hashIndex+1) + "]");
			} catch (e) {
				console.log("Invalid hash: " + filepath);
			}
			filepath = filepath.substring(0, hashIndex);
		}
		if (!range) {
			// try to get range from history
			var histItem = getHistoryAsObject()[filepath];
			if (histItem) {
				range = histItem.range;
			}
		}
		
		if (isBinary(filepath)) {
			alert("Cannot open binary files");
			return false;
		}
		

		
		var target = findTarget(event);
		if (editor) {
			// if coming from sub-editor, we want to stay in same editor if no modifiers are used
			if (editor.type === EDITOR_TARGET.sub) {
				if (target === EDITOR_TARGET.sub) {
					target = EDITOR_TARGET.main;
				} else if (target === EDITOR_TARGET.main) {
					target = EDITOR_TARGET.sub;
				}
			}
		}
		navigate(filepath, range, target, true);	
		return false;
	};
	

	var switchEditors = function() {
		if (window.subeditors[0] === undefined) {
			return false;
		}
		var main_path = window.editor.getFilePath();
		var main_scrollpos = $(window.editor._domNode).find('.textview').scrollTop();
		var main_sel = window.editor.getTextView().getSelection();
		var main_text = window.editor.getText();
		var main_dirty = window.editor.isDirty();
		
		var sub_path = window.subeditors[0].getFilePath();
		var sub_scrollpos = $(window.subeditors[0]._domNode).find('.textview').scrollTop();
		var sub_sel = window.subeditors[0].getTextView().getSelection();
		var sub_text = window.subeditors[0].getText();
		var sub_dirty = window.subeditors[0].isDirty();
		
		// TODO This is not working when using the button to switch since 
		// clicking on the button will call a blur() on the active editor
		var main_active = window.editor.getTextView().hasFocus();
		
		navigate(main_path, [main_sel.start, main_sel.end], EDITOR_TARGET.sub, true);
		navigate(sub_path, [sub_sel.start, sub_sel.end], EDITOR_TARGET.main, true);
		
		$(window.editor._domNode).find('.textview').scrollTop(sub_scrollpos);
		$(window.subeditors[0]._domNode).find('.textview').scrollTop(main_scrollpos);
		
		if (sub_dirty) {
			window.editor.setText(sub_text);
		}
		if (main_dirty) {
			window.subeditors[0].setText(main_text);
		}
		
		setTimeout(function() {
			if (main_active) {
				window.subeditors[0].getTextView().focus();
			} else {
				window.editor.getTextView().focus();
			}
		}, 200);
	};
	
	var confirmer;
	var _setNavigationConfirmer = function(callback) {
		confirmer = callback;
	};

	var confirmNavigation = function(editor) {
	
		if (editor && editor.isDirty()) {
			if (confirmer) {
				// non-blocking mode for tests
				confirmer(true);
				return true;
			} else {
				return confirm("Editor has unsaved changes.  Are you sure you want to leave this page?  Your changes will be lost.");
			}
		} else {
			if (confirmer) {
				confirmer(false);
			}
			return true;
		}
	};
	
	
	/**
	 * Opens the given editor on the given definition
	 * @param {{String|Object}} modifier either EDITOR_TARGET.main, EDITOR_TARGET.sub, or EDITOR_TARGET.tab
	 * @param {{range:List.<Number>,path:String}} definition
	 * @param {{Editor}} editor
	 */
	var openOnRange = function(modifier, definition, editor) {
		if (!definition.range && !definition.path) {
			return;
		}
		var defnrange = definition.range ? definition.range : editor.getSelection();
		var filepath = definition.path ? definition.path : editor.getFilePath();
		
		console.log("navigation: "+JSON.stringify({path: filepath, range: defnrange}));
		
		var target;
		if (typeof modifier === "object") {
			target = findTarget(modifier);
		} else if (typeof modifier === "string") {
			target = modifier;
		}
		if (target) {
			if (editor) {
				// if coming from sub-editor, we want to stay in same editor if no modifiers are used
				if (editor.type === EDITOR_TARGET.sub) {
					if (target === EDITOR_TARGET.sub) {
						target = EDITOR_TARGET.main;
					} else if (target === EDITOR_TARGET.main) {
						target = EDITOR_TARGET.sub;
					}
				}
			}
			navigate(filepath, defnrange, target, true);
		}
	};

	function openOnClick(event, editor) {
		if (mOsUtils.isCtrlOrMeta(event)) {
			var rect = editor.getTextView().convert({x:event.pageX, y:event.pageY}, "page", "document");
			var offset = editor.getTextView().getOffsetAtLocation(rect.x, rect.y);
			var definition = editor.findDefinition(offset);
			if (definition) {
				openOnRange(event.shiftKey ? EDITOR_TARGET.sub : EDITOR_TARGET.main, definition, editor);
			}
		}
	}
	
	/**
	 * Adds one-time configuration to the main editor
	 */
	var buildMaineditor = function() {
		$('#editor').click(function(event) {
			openOnClick(event, window.editor);
		});
	};
	
	var buildSubeditor = function(filepath) {
		var filename = filepath.split('/').pop();
		
		// TODO move this html snippet to separate file
		var subeditor = 
		$('<div class="subeditor_wrapper">'+
			'<div class="subeditor_titlebar">'+
				'<span class="subeditor_title" title="'+filepath+'">'+filename+'</span>'+
				'<span class="subeditor_options">'+
					'<span class="subeditor_switch" title="Switch Subeditor and Main Editor"></span>'+
					'<span class="subeditor_close" title="Close Subeditor"></span>'+
				'</span>'+
			'</div>'+
			'<div class="subeditor scriptededitor"></div>'+
		'</div>');
		$('#side_panel').append(subeditor);
		
		var sideHeight = $('#side_panel').height();
		var subeditorMargin = parseInt($('.subeditor_wrapper').css('margin-top'), 10);
		
		$('.subeditor_wrapper').height(sideHeight - (subeditorMargin*2));
		$('.subeditor').height(
			$('.subeditor_wrapper').height() -
			$('.subeditor_titlebar').height()
		);
		
		// must reattach these handlers on every new subeditor open since we always delete the old editor
		$('.subeditor_close').click(function() {
			if (window.subeditors[0] && confirmNavigation(window.subeditors[0])) {
				$('.subeditor_wrapper').remove();
				window.subeditors.pop();
				close_side(window.editor);
				window.editor.getTextView().focus();
			}
		});
		
		$('.subeditor_switch').click(switchEditors);
		
		$('.subeditor').click(function(event) {
			openOnClick(event, window.subeditors[0]);
		});
		return subeditor;
	};
	
	var toggleSidePanel = function() {
		if ($('#side_panel').css('display') === 'none') {
			var sel = window.editor.getSelection();
			var range = [sel.start, sel.end];
			navigate(window.editor.getFilePath(), range, EDITOR_TARGET.sub);
			window.subeditors[0].getTextView().focus();
		} else {
			$('.subeditor_close').click();
		}
	};
	
	var fileEntryCompare = function(a, b) {
		a = a.name.toLowerCase();
		b = b.name.toLowerCase();
		if (a<b) {
			return +1;
		} else if (a>b) {
			return -1;
		} else {
			return 0;
		}
	};

	var initializeHistoryMenu = function() {
		var historyCrumb = $('#historycrumb');
		if (!historyCrumb.html()) {
			historyCrumb = $('<li id="historycrumb" data-id="-1"><span><img src="/images/icon.png" /></span></li>');
			$('#breadcrumb').append(historyCrumb);
		}		
		var historyMenu = $('<ul id="history_menu" class="breadcrumb_menu" data-id="-1"></ul>');
		historyMenu.css('left', historyCrumb.position().left);
		historyMenu.css('top', $('header').height() + $('#breadcrumb').height());
		$('#main').append(historyMenu);
		
		
		var history = getHistory();
		
		for (var i = history.length-1; i >= 0; i--) {
			var newHistoryElem = $('<li></li>');
			var newHistoryAnchor = $('<a href="' + history[i].url + '">'+history[i].filename+'</a>');
			$(newHistoryAnchor).click(navigationEventHandler);
			newHistoryElem.append(newHistoryAnchor);
			historyMenu.append(newHistoryElem);
		}
	};
	
	var initializeBreadcrumbs = function(path) {
		var root = window.fsroot;
		var basepath = window.location.protocol + "//" + window.location.host + window.location.pathname + '?';
	
//		$('#breadcrumb li:not(:first)').remove();
		$('.breadcrumb_menu').remove();
		$('#breadcrumb li').remove();

		initializeHistoryMenu();
		
		var crumbs = path.substring(1 + root.length, path.length).split('/'); // the first position is moved up by 1 for the trailing '/'
		crumbs.splice(0, 0, root);
		var constructedPath = "", newCrumbElem, xhrobj, url;
			
		for (var i = 0, len = crumbs.length; i < len; i++) {
			newCrumbElem = $('<li class="light_gradient" data-id="'+i+'"><span>' + crumbs[i] + '</span></li>');
			$('#breadcrumb').append(newCrumbElem);	

			if (i + 1 === len) { 
				constructedPath += crumbs[i];
			} else {
				constructedPath += crumbs[i] + '/';
				url = 'http://localhost:7261/fs_list/'+constructedPath.substring(0, constructedPath.length-1);
				xhrobj = new XMLHttpRequest();
				xhrobj.open("GET",url,false); // TODO naughty? synchronous xhr
				xhrobj.send();
				var kids = JSON.parse(xhrobj.responseText).children;
				if (kids) {

					kids.sort(fileEntryCompare);

					var newMenu = $('<ul class="breadcrumb_menu" data-id="'+i+'"></ul>');
					for(var j = 0; j < kids.length; j++) {
						if (kids[j].directory === false) {
							if (kids[j].name.lastIndexOf('.',0)!==0) {
								var href = basepath + kids[j].Location;
								var newMenuItem = $('<li></li>');
								var newMenuAnchor = $('<a href="'+href+'">'+kids[j].name+'</a>');
								newMenuItem.append(newMenuAnchor);
								newMenu.prepend(newMenuItem);

								$(newMenuAnchor).click(navigationEventHandler);
							}
						}
					}
					newMenu.css('left', newCrumbElem.position().left);
					newMenu.css('min-width', newCrumbElem.outerWidth());
					newMenu.css('top', $('header').height() + $('#breadcrumb').height());
					$('#main').append(newMenu);
				}
			}
		}

		var id;
		
		$('#breadcrumb > li').on('mouseenter', function(evt) {
			id = $(this).attr('data-id');
			$('.breadcrumb_menu[data-id='+id+']').css('left', $(this).position().left);
			$('.breadcrumb_menu[data-id='+id+']').show();
		});

		$('#breadcrumb > li').on('mouseleave', function(evt) {
			id = $(this).attr('data-id');
			if (evt.pageY < this.offsetTop + $(this).outerHeight()) { 
				$('.breadcrumb_menu[data-id='+id+']').hide();
			}
		});
		
		$('.breadcrumb_menu').on('mouseleave', function(evt) {
			$(this).hide();
		});

		$('.breadcrumb_menu > li').hover(function() {
			$(this).addClass('light_gradient_active');
			$(this).removeClass('light_gradient');
		}, function() {
			$(this).addClass('light_gradient');
			$(this).removeClass('light_gradient_active');
		});
	};
	
	// Need to load searcher here instead of scriptedEditor.js to avoid circular dependencies
	// Before : scriptedEditor.js -> searchClient.js -> navHistory.js -> scriptedEditor.js : BAD
	
	var attachSearchClient = function(editor) {
	
		var searcher = new mSearchClient.Searcher({
			serviceRegistry: null,
			commandService: null,
			fileService: null
		});

		// from globalCommands.js
		var openResourceDialog = function(searcher, serviceRegistry, editor) {
			var dialog = new scripted.widgets.OpenResourceDialog({
				searcher: searcher,
				searchRenderer: searcher.defaultRenderer,
				favoriteService: null,
				changeFile: navigationEventHandler,
				editor: editor
			});
			if (editor) {
				dojo.connect(dialog, "onHide", function() {
//					editor.getTextView().focus(); // focus editor after dialog close, dojo's doesnt work
				});
			}
			window.setTimeout(function() {
				dialog.show();
			}, 0);
		};
		
		if (editor) {
			editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding("f", /*command/ctrl*/ true, /*shift*/ true, /*alt*/ false), "Find File Named...");
			editor.getTextView().setAction("Find File Named...", function() {
				openResourceDialog(searcher, null, editor);
				return true;
			});		
		} else {
			$('body').on('keydown', function(evt) {
				if (evt.shiftKey && evt.ctrlKey && evt.which === 70 /*F*/) {
					openResourceDialog(searcher, null, null);
					return true;
				}
			});
		}
	};
	
	var attachOutlineClient = function(editor) {

		// from globalCommands.js
		var openOutlineDialog = function(searcher, serviceRegistry, editor) {
			var dialog = new scripted.widgets.OpenOutlineDialog({
				// TODO FIXADE Do we need this?
//				changeFile: navigationEventHandler,
				editor: editor
			});
			if (editor) {
				dojo.connect(dialog, "onHide", function() {
//					editor.getTextView().focus(); // focus editor after dialog close, dojo's doesnt work
				});
			}
			window.setTimeout(function() {
				dialog.show();
			}, 0);
		};
		
		editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding("o", /*command/ctrl*/ true, /*shift*/ true, /*alt*/ false), "Show Outline");
		editor.getTextView().setAction("Show Outline", function() {
			openOutlineDialog(null,/*searcher,*/ null, editor);
			return true;
		});		
	};
	

	// TODO move to scriptedEditor.js
	var attachFileSearchClient = function(editor) {
	
		var fileSearcher = new mFileSearchClient.FileSearcher({
		});
	
		var openFileSearchDialog = function(editor) {
			var dialog = new scripted.widgets.SearchDialog({
				editor: editor,
				fileSearcher: fileSearcher,
				fileSearchRenderer: fileSearcher.defaultRenderer,
				style:"width:800px",
				openOnRange: openOnRange
			});
			
			//TODO we should explicitly set focus to the previously active editor if the dialog has been canceled
//			if (editor) {
//				dojo.connect(dialog,"onHide", function() {
//					editor.getTextView().focus(); // focus editor after dialog closed
//				});
//			}
			window.setTimeout(function() {
				dialog.show();
			},0);
		};
		
		editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding("l",/*CMD/CTRL*/true,/*SHIFT*/true,/*ALT*/false),"Look in files");
		editor.getTextView().setAction("Look in files",function() {
			openFileSearchDialog(editor);
		});
	};
	
	
	// TODO move to scriptedEditor.js
	var attachDefinitionNavigation = function(editor) {
		editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding(/*F8*/ 119, /*command/ctrl*/ false, /*shift*/ false, /*alt*/ false), "Open declaration in same editor");
		editor.getTextView().setAction("Open declaration in same editor", function() { 
			var definition = editor.findDefinition(editor.getTextView().getCaretOffset());
			if (definition) {
				openOnRange(EDITOR_TARGET.main, definition, editor);
			}
		});
		editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding(/*F8*/ 119, /*command/ctrl*/ true, /*shift*/ false, /*alt*/ false), "Open declaration in new tab");
		editor.getTextView().setAction("Open declaration in new tab", function() {
			var definition = editor.findDefinition(editor.getTextView().getCaretOffset());
			if (definition) {
				openOnRange(EDITOR_TARGET.tab, definition, editor);
			}
		});
		editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding(/*F8*/ 119, /*command/ctrl*/ false, /*shift*/ true, /*alt*/ false), "Open declaration in other editor");
		editor.getTextView().setAction("Open declaration in other editor", function() {
			var definition = editor.findDefinition(editor.getTextView().getCaretOffset());
			if (definition) {
				openOnRange(EDITOR_TARGET.sub, definition, editor);
			}
		});
	};
	
	// TODO move to scriptedEditor.js
	var attachEditorSwitch = function(editor) {
		editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding("s", /*command/ctrl*/ true, /*shift*/ true, /*alt*/ false), "Switch Subeditor and Main Editor");
		editor.getTextView().setAction("Switch Subeditor and Main Editor", switchEditors);
		
		editor.getTextView().setKeyBinding(new mKeyBinding.KeyBinding("e", /*command/ctrl*/ true, /*shift*/ true, /*alt*/ false), "Toggle Subeditor");
		editor.getTextView().setAction("Toggle Subeditor", toggleSidePanel);		
	};
	
	/**
	 * This handles initial page load
	 */
	var loadEditor = function(filepath, domNode, type) {
		if (!type) {
			type = "main";
		}
		if (!domNode) {
			domNode = $('#editor')[0];
		}
		$(domNode).show();
		$('body').off('keydown');
		var editor = mEditor.makeEditor(domNode, filepath, type);
		if (editor.loadResponse === 'error') {
			$(domNode).hide();
			attachSearchClient(null);
			$('.subeditor_close').click();
			return editor;
		}
		
		// TODO move to scriptedEditor.js
		attachSearchClient(editor);
		attachOutlineClient(editor);
		attachDefinitionNavigation(editor);
		attachFileSearchClient(editor);
		attachEditorSwitch(editor);
		editor.cursorFix();
		
		if (type === 'main') {
			setTimeout(function() {
				editor.getTextView().focus();
			}, 5);
		}
		return editor;
	};

	/**
	 * handles the onpopstate event
	 */
	var popstateHandler = function(event) {
		var target = findTarget(event);
		var state = event.originalEvent.state;
		if (state && state.filepath) {
			navigate(state.filepath, state.range, target);
			return false;
		} else {
			return true;
		}
	};
	

	

	/**
	 * Navigates to a new editor
	 * @param {String} filepath the path to the target file
	 * @param {Array.<Number>} range 2 element array specifying offset and length of target selection
	 * @param {String} target the target of the navigation, either EDITOR_TARGET.main, EDITOR_TARGET.sub, or EDITOR_TARGET.tab for 
	 * displaying in the main editor, the sub-editor or a new tab.  If a null or invalid value is passed
	 * there will be an attempt to guess the target
	 *
	 * @return {boolean} true if navigation occurred successfully and false otherwise.
	 */
	navigate = function(filepath, range, target, doSaveState) {
		var histItem;
		// check if the editor has been created yet, or if
		// window.editor is a dom node
		var hasMainEditor = window.editor && window.editor.getText;
		var hasSubEditpr = hasMainEditor && window.subeditors.length > 0;
		if (hasMainEditor) {
			histItem = generateHistoryItem(window.editor);
			storeScriptedHistory(histItem);
			if (doSaveState) {
				storeBrowserState(histItem, true);
			}
			if (hasSubEditpr) {
				histItem = generateHistoryItem(window.subeditors[0]);
				storeScriptedHistory(histItem);
			}
		}

		if (target === EDITOR_TARGET.sub || target === EDITOR_TARGET.main) {
			var targetEditor = target === EDITOR_TARGET.main ? window.editor : window.subeditors[0];
			var hasEditor = targetEditor && targetEditor.getText;
			var isSame = hasEditor && targetEditor.getFilePath() === filepath;
			if (!isSame && hasEditor && !confirmNavigation(targetEditor)) {
				return false;
			}
			
			// this is annoying...the targetEditor is destroyed and recreated here so can't get the dom node undil after this if statement
			if (target === EDITOR_TARGET.sub && !isSame) {
				open_side(window.editor);
				$('.subeditor_wrapper').remove();
				buildSubeditor(filepath);
			}
			var domNode = target === EDITOR_TARGET.main ? $('#editor') : $('.subeditor');
			if (target === EDITOR_TARGET.main) {
				if (!hasEditor) {
					buildMaineditor(filepath);
				}
				domNode.css('display','block');
			}

			if (!hasEditor || !isSame) {
				targetEditor = loadEditor(filepath,  domNode[0], target);
			}

			if (range) {
				if (isNaN(range[0]) || isNaN(range[1])) {
					console.log("invalid range");
					console.log(range);
				}
				targetEditor.getTextView().setSelection(range[0], range[1], true);
				scrollToSelection(targetEditor);
			}

			if (target === EDITOR_TARGET.main) {
				// explicit check for false since navigator might be 'undefined' at this point
				if (window.scripted.navigator !== false) {
					// if model not yet available, highlighting is handled elsewhere.
					if (explorer.model) {
						explorer.highlight(filepath);
					}
				}
				initializeBreadcrumbs(filepath);
				window.editor = targetEditor;
				if (doSaveState) {
					histItem = generateHistoryItem(targetEditor);
					storeBrowserState(histItem);
				}
			} else {
				window.subeditors[0] = targetEditor;
				initializeHistoryMenu();
			}
			targetEditor.getTextView().focus();

		} else if (target === EDITOR_TARGET.tab) {
			var targetPath = range ? filepath + "#" + range : filepath;
			var rootpath = window.location.protocol + "//" + window.location.host + window.location.pathname + '?';
			window.open(rootpath + targetPath);
		}

		return false;
	};
		
	return {
		// private functions that are only exported to help with testing
		_loadEditor: loadEditor,
		_setNavigationConfirmer : _setNavigationConfirmer,
		
//		highlightSelection: highlightSelection,  don't think we need this
		openOnRange: openOnRange,
		initializeBreadcrumbs: initializeBreadcrumbs,
		navigationEventHandler: navigationEventHandler,
		popstateHandler: popstateHandler,
		toggleSidePanel: toggleSidePanel,
		navigate: navigate
	};
});