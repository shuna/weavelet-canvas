import XCTest
import JavaScriptCore
@testable import WeaveletPilot

final class PromptApplicationTests: XCTestCase {
    private func json(_ text: String) throws -> OrderedJSON { try OrderedJSON.decode(Data(text.utf8)) }
    private func parts() throws -> OrderedJSON {
        try json(#"[{"type":"image_url","image_url":{"url":"image","detail":"auto","raw":9007199254740993},"extra":{"value":1.2300}},{"type":"text","text":"later","metadata":{"keep":1.2300}},{"type":"reasoning","text":"reason","extra":[9007199254740993]}]"#)
    }
    private func result(_ result: PromptPickerResult) throws -> ComposerDraft {
        guard case .command(let draft) = result else { throw ExchangeError.invalid("test result") }
        return draft
    }
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/message-editing.json"))).required("cases").array("cases")[0].required("input")
    }
    private func body(_ state: ChatState, node: String = "middle") throws -> OrderedJSON {
        let source = try XCTUnwrap(state.exchange).source
        let hash = try source.required("chats").array("chats")[0].required("branchTree").required("nodes").required(node).required("contentHash").string("hash")
        return try source.required("contentStore").required(hash).required("content")
    }
    func testRealJSCSearchNamesAccentAndSameNameTiesWithoutLabelRestriction() async throws {
        let snapshot = try json(#"{"state":{"prompts":[{"name":"Alpha","prompt":"one","label":"system"},{"name":"Alpha","prompt":"two","label":"user"},{"name":"café","prompt":"accent"},{"name":"Cafe","prompt":"plain"},{"name":"Other","prompt":"Alpha"}]}}"#)
        let worker = PromptApplication()
        let names = try await worker.search(snapshot: snapshot, query: "alpha")
        XCTAssertEqual(names.map(\.id), [0, 1])
        XCTAssertEqual(names.map(\.body), ["one", "two"])
        let accents = try await worker.search(snapshot: snapshot, query: "cafe")
        XCTAssertEqual(accents.map(\.id), [2, 3])
        let unicode = try json(#"{"state":{"prompts":[{"name":"café","prompt":"accent"}]}}"#)
        let decomposed = try await worker.search(snapshot: unicode, query: "e\u{301}")
        let composed = try await worker.search(snapshot: unicode, query: "é")
        XCTAssertTrue(decomposed.isEmpty)
        XCTAssertEqual(composed.map(\.id), [0])
        let none = try await worker.search(snapshot: snapshot, query: "plain")
        XCTAssertTrue(none.isEmpty)
        let updated = try json(#"{"state":{"prompts":[{"name":"Newest","prompt":"new"}]}}"#)
        let latest = try await worker.search(snapshot: updated, query: "new")
        XCTAssertEqual(latest.map(\.body), ["new"])
    }
    func testRealJSCApplicationPreservesRawPartsAndMetadata() async throws {
        let worker = PromptApplication(), original = try parts()
        let applied = try result(await worker.apply(.command(parts: original, text: "edited later"), text: "prompt"))
        let rows = try applied.parts.array("parts"), before = try original.array("parts")
        XCTAssertEqual(applied.text, "prompt")
        XCTAssertEqual(try rows[1].encoded(), try before[0].encoded())
        XCTAssertEqual(try rows[2].encoded(), try before[1].replacing("text", with: .string("edited later")).encoded())
        XCTAssertEqual(try rows[3].encoded(), try before[2].encoded())
        let text = try json(#"[{"type":"text","text":"old","metadata":{"raw":1.2300}}]"#)
        let appended = try result(await worker.apply(.command(parts: text, text: "current"), text: "prompt"))
        XCTAssertEqual(try appended.parts.array("parts")[0].encoded(), try text.array("parts")[0].replacing("text", with: .string("currentprompt")).encoded())
        let unknown = try json(#"[{"type":"future","value":9007199254740993}]"#)
        let kept = try result(await worker.apply(.command(parts: unknown, text: ""), text: "prompt"))
        XCTAssertEqual(try kept.parts.array("parts")[1].encoded(), try unknown.array("parts")[0].encoded())
        guard case .system(let system) = try await worker.apply(.system(text: " "), text: "prompt") else { return XCTFail("system") }
        XCTAssertEqual(system, " \n\nprompt")
    }
    func testSystemPromptDefaultsAndConversationSaveStaySeparate() async throws {
        let state = ChatState(), worker = PromptApplication()
        try state.importWebData(fixture().encoded())
        var config = try state.chatConfigDraft()
        config.config = config.config.replacing("systemPrompt", with: .string("existing"))
            .replacing("metadata", with: .object([.init(key: "raw", value: .number("1.2300"))]))
        guard case .system(let inserted) = try await worker.apply(.system(text: "existing"), text: "library") else { return XCTFail("system") }
        config.config = try ChatConfig.switched(config.config, model: "new-model", providerID: nil, modelState: config.modelState)
            .replacing("systemPrompt", with: .string(inserted))
        try state.saveChatConfig(config, now: 1000)
        let saved = try state.chatConfigDraft().config
        XCTAssertEqual(saved["systemPrompt"], .string("existing\n\nlibrary"))
        XCTAssertEqual(saved["metadata"]?["raw"], .number("1.2300"))
        var defaults = try state.defaultChatConfigDraft()
        let old = defaults.defaultSettings!.systemMessage
        guard case .system(let initial) = try await worker.apply(.system(text: old), text: "default library") else { return XCTFail("default") }
        defaults.defaultSettings?.systemMessage = initial
        try state.saveDefaultChatConfig(defaults)
        XCTAssertEqual(try state.defaultChatConfigDraft().defaultSettings?.systemMessage, initial)
        XCTAssertEqual(try state.chatConfigDraft().config["systemPrompt"], saved["systemPrompt"])
    }
    func testBuiltInPresetUsesRealWebMarkdownAndECMAScriptConfirmation() async throws {
        let worker = PromptApplication(), presets = try await worker.systemPresets()
        let preset = try XCTUnwrap(presets.first)
        XCTAssertEqual(preset.id, "claude-fable-5")
        XCTAssertEqual(preset.name, "Claude Fable 5")
        XCTAssertFalse(preset.description.isEmpty)
        XCTAssertEqual(preset.approxTokens, 30000)
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let raw = try String(contentsOf: root.appendingPathComponent("src/constants/presets/claude-fable-5.md"), encoding: .utf8)
        let context = try XCTUnwrap(JSContext())
        let trim = try XCTUnwrap(context.evaluateScript("(value) => value.trim()"))
        let expected = try XCTUnwrap(trim.call(withArguments: [raw])?.toString())
        let blank = try await worker.systemPreset(id: preset.id, previous: "\u{FEFF}\u{00A0}\u{2028}")
        XCTAssertFalse(blank.needsConfirmation)
        XCTAssertEqual(Data(blank.content.utf8), Data(expected.utf8))
        let same = try await worker.systemPreset(id: preset.id, previous: "\u{FEFF}" + blank.content + "\u{00A0}")
        XCTAssertFalse(same.needsConfirmation)
        let existing = try await worker.systemPreset(id: preset.id, previous: "existing")
        XCTAssertTrue(existing.needsConfirmation)
        XCTAssertEqual(Data(existing.content.utf8), Data(expected.utf8))
        let zeroWidth = try await worker.systemPreset(id: preset.id, previous: "\u{200B}")
        XCTAssertTrue(zeroWidth.needsConfirmation)
    }
    func testPresetPendingDoesNotSaveAndRejectsChangedInputAtConfirmation() async throws {
        let state = ChatState(), worker = PromptApplication()
        try state.importWebData(fixture().encoded())
        var draft = try state.defaultChatConfigDraft()
        draft.defaultSettings?.systemMessage = "existing"
        let snapshot = try state.publicationSnapshot(), request = try state.promptPickerRequest(.system(text: "existing"))
        let choice = try await worker.systemPreset(id: "claude-fable-5", previous: "existing")
        XCTAssertTrue(choice.needsConfirmation)
        XCTAssertEqual(draft.defaultSettings?.systemMessage, "existing")
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try snapshot.encoded())
        XCTAssertNoThrow(try state.validatePromptPicker(request, input: .system(text: "existing")))
        draft.defaultSettings?.systemMessage = "newer input"
        XCTAssertThrowsError(try state.validatePromptPicker(request, input: .system(text: draft.defaultSettings!.systemMessage)))
        XCTAssertEqual(draft.defaultSettings?.systemMessage, "newer input")
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try snapshot.encoded())
        let current = try state.promptPickerRequest(.system(text: "newer input"))
        try state.validatePromptPicker(current, input: .system(text: draft.defaultSettings!.systemMessage))
        draft.defaultSettings?.systemMessage = choice.content
        XCTAssertEqual(draft.defaultSettings?.systemMessage, choice.content)
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try snapshot.encoded())
    }
    func testStaleSourceCrossChatAndNewerInputsAreRejected() throws {
        let snapshot = try json(#"{"state":{"prompts":[]}}"#)
        let input = PromptPickerInput.command(parts: try parts(), text: "before")
        let request = PromptPickerRequest(snapshot: snapshot, chatID: "chat", input: input)
        XCTAssertNoThrow(try PromptApplication.validate(request, snapshot: snapshot, chatID: "chat", input: input))
        XCTAssertThrowsError(try PromptApplication.validate(request, snapshot: snapshot, chatID: "other", input: input))
        XCTAssertThrowsError(try PromptApplication.validate(request, snapshot: snapshot.replacing("state", with: .object([])), chatID: "chat", input: input))
        XCTAssertThrowsError(try PromptApplication.validate(request, snapshot: snapshot, chatID: "chat", input: .command(parts: parts(), text: "newer")))
        let system = PromptPickerRequest(snapshot: snapshot, chatID: "chat", input: .system(text: "before"))
        XCTAssertThrowsError(try PromptApplication.validate(system, snapshot: snapshot, chatID: "chat", input: .system(text: "newer")))
    }
    func testComposerIsDraftOnlyAndNewerDraftIsKept() async throws {
        let state = ChatState(), worker = PromptApplication()
        try state.importWebData(fixture().encoded())
        let chatID = state.selectedConversationID, snapshot = try state.publicationSnapshot()
        let expected = state.composerDraft(chatID: chatID)
        let applied = try result(await worker.apply(.command(parts: expected.parts, text: expected.text), text: "prompt"))
        try state.setComposerPrompt(applied, chatID: chatID, expected: expected)
        XCTAssertEqual(state.composerDraft(chatID: chatID).text, "prompt")
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try snapshot.encoded())
        state.setComposerText(chatID: chatID, text: "newer")
        XCTAssertThrowsError(try state.setComposerPrompt(applied, chatID: chatID, expected: applied))
        XCTAssertEqual(state.composerDraft(chatID: chatID).text, "newer")
    }
    func testEditorDraftCancelSavePruneAndHistoryKeepAllAppliedParts() async throws {
        let original = try parts(), worker = PromptApplication()
        var input = try fixture(), store = try input.required("contentStore")
        store = store.replacing("h-middle", with: try store.required("h-middle").replacing("content", with: original))
        input = input.replacing("contentStore", with: store)
        for prune in [false, true] {
            let state = ChatState(); try state.importWebData(input.encoded())
            var draft = try state.messageDraft(nodeID: "middle")
            XCTAssertFalse(draft.changed)
            XCTAssertEqual(try draft.parts.encoded(), try original.encoded())
            let applied = try result(await worker.apply(.command(parts: draft.parts, text: "edited later"), text: "prompt"))
            draft.promptParts = applied.parts; draft.text = applied.text
            XCTAssertTrue(draft.changed)
            XCTAssertEqual(try body(state).encoded(), try original.encoded())
            if prune {
                draft.isReplacingAndPruning = true; draft.removeCount = 0
                let result = try state.saveMessageReplacingAndPruning(draft, now: 1000)
                XCTAssertEqual(result.status, "updated")
            } else { try state.saveMessage(draft, mode: .overwrite, now: 1000) }
            XCTAssertEqual(try body(state).encoded(), try applied.parts.encoded())
            try state.undoMessageEdit(now: 1001)
            XCTAssertEqual(try body(state).encoded(), try original.encoded())
        }
    }
}
