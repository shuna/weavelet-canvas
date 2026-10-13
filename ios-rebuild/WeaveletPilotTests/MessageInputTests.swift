import XCTest
import SwiftUI
@testable import WeaveletPilot

@MainActor final class MessageInputTests: XCTestCase {
    func testActualSharedPolicyAndMarkedTextBoundary() throws {
        XCTAssertEqual(try EnterSubmission.action(key: "Enter", composing: false, control: false, shift: false, enterToSubmit: true, sticky: true), .generate)
        XCTAssertEqual(try EnterSubmission.action(key: "Enter", composing: false, control: false, shift: false, enterToSubmit: true, sticky: false), .save)
        XCTAssertNil(try EnterSubmission.action(key: "Enter", composing: true, control: true, shift: true, enterToSubmit: true, sticky: true))
        XCTAssertNil(try EnterSubmission.action(key: "x", composing: false, control: true, shift: true, enterToSubmit: true, sticky: true))
    }

    func testOSInputUsesCurrentDraftKeepsSelectionAndSoftwareNewline() throws {
        var draft = "abcdef"
        var enabled = true
        var actions: [EnterSubmission.Action] = []
        func input() -> MessageInputView {
            MessageInputView(text: Binding(get: { draft }, set: { draft = $0 }), label: "本文", enabled: enabled, sticky: true,
                enterToSubmit: { true }, submit: { actions.append($0) }, failure: { XCTFail($0.localizedDescription) })
        }
        let coordinator = input().makeCoordinator()
        let view = MessageInputTextView()
        view.delegate = coordinator
        coordinator.update(view)
        view.selectedRange = NSRange(location: 2, length: 2)
        coordinator.update(view)
        XCTAssertEqual(view.selectedRange, NSRange(location: 2, length: 2))
        let returnCommand = try XCTUnwrap(view.keyCommands?.first { $0.input == "\r" && $0.modifierFlags.isEmpty && $0.wantsPriorityOverSystemBehavior })
        let returnAction = try XCTUnwrap(returnCommand.action)
        XCTAssertFalse(view.keyCommands?.contains { $0.input == "\r" && $0.modifierFlags == .shift && $0.wantsPriorityOverSystemBehavior } ?? false)
        XCTAssertTrue(UIApplication.shared.sendAction(returnAction, to: view, from: returnCommand, for: nil))
        XCTAssertEqual(actions, [.generate])
        XCTAssertEqual(view.text, "abcdef")
        view.selectedRange = NSRange(location: 6, length: 0)
        view.insertText("\n")
        XCTAssertEqual(view.text, "abcdef\n")
        XCTAssertEqual(actions, [.generate])
        coordinator.textViewDidChange(view)
        XCTAssertEqual(draft, "abcdef\n")
        draft = "外部の本文"
        coordinator.input = input()
        coordinator.update(view)
        XCTAssertEqual(view.text, draft)
        XCTAssertLessThanOrEqual(view.selectedRange.location, (draft as NSString).length)
        draft = "é"
        coordinator.input = input()
        coordinator.update(view)
        draft = "e\u{0301}"
        coordinator.input = input()
        coordinator.update(view)
        XCTAssertTrue(view.text.utf8.elementsEqual(draft.utf8))
        view.selectedRange = NSRange(location: (draft as NSString).length, length: 0)
        view.insertText("!")
        coordinator.textViewDidChange(view)
        XCTAssertTrue(draft.utf8.elementsEqual("e\u{0301}!".utf8))
        view.setMarkedText("候補", selectedRange: NSRange(location: 2, length: 0))
        XCTAssertNotNil(view.markedTextRange)
        XCTAssertFalse(view.canPerformAction(returnAction, withSender: returnCommand))
        XCTAssertFalse(view.keyCommands?.contains { $0.action == returnCommand.action } ?? false)
        XCTAssertFalse(view.handleHardwareKey("Enter", modifiers: [.control, .shift]))
        XCTAssertEqual(actions, [.generate])
        view.unmarkText()
        enabled = false
        coordinator.input = input()
        coordinator.update(view)
        XCTAssertFalse(view.handleHardwareKey("Enter", modifiers: []))
        XCTAssertEqual(actions, [.generate])
    }

    func testSubmissionFailurePreservesTextAndSelection() {
        var draft = "保存する本文"
        let input = MessageInputView(text: Binding(get: { draft }, set: { draft = $0 }), label: "本文", enabled: true, sticky: false,
            enterToSubmit: { throw ExchangeError.invalid("保存失敗") }, submit: { _ in XCTFail("should not submit") }, failure: { _ in })
        let coordinator = input.makeCoordinator()
        let view = MessageInputTextView()
        coordinator.update(view)
        view.selectedRange = NSRange(location: 2, length: 0)
        XCTAssertTrue(view.handleHardwareKey("Enter", modifiers: []))
        XCTAssertEqual(view.text, draft)
        XCTAssertEqual(view.selectedRange.location, 2)
    }
    func testEditorGenerationRejectsProtectedFollowingBeforeSavingAndRefreshesSuccessfulDraft() throws {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let fixture = try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/message-editing.json")))
        let source = try fixture.required("cases").array("cases")[0].required("input")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        final class Fault { var rejects = false }
        let fault = Fault()
        let local = LocalStateStore(fileURL: directory.appendingPathComponent("state.json")) { data, url in
            if fault.rejects { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: url, options: .atomic)
        }
        let state = ChatState(store: local)
        var chats = try source.required("chats").array("chats")
        chats[0] = chats[0].replacing("protectedNodes", with: .object([.init(key: "last", value: .bool(true))]))
        try state.importWebData(source.replacing("chats", with: .array(chats)).encoded())
        var draft = try state.messageDraft(nodeID: "middle")
        draft.text = "Edited for generation"
        let before = try XCTUnwrap(state.exchange).source
        let disk = try Data(contentsOf: local.fileURL)
        XCTAssertThrowsError(try state.saveMessageForGeneration(draft))
        XCTAssertEqual(state.exchange?.source, before)
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        XCTAssertEqual(draft.text, "Edited for generation")
        try state.importWebData(source.encoded())
        draft = try state.messageDraft(nodeID: "middle")
        draft.text = "Edited for generation"
        let unprotected = try XCTUnwrap(state.exchange).source
        let unprotectedDisk = try Data(contentsOf: local.fileURL)
        fault.rejects = true
        XCTAssertThrowsError(try state.saveMessageForGeneration(draft))
        XCTAssertEqual(state.exchange?.source, unprotected)
        XCTAssertEqual(try Data(contentsOf: local.fileURL), unprotectedDisk)
        fault.rejects = false
        let fresh = try state.saveMessageForGeneration(draft)
        XCTAssertEqual(state.conversation?.visibleMessages.map(\.id), ["system", "middle"])
        XCTAssertEqual(fresh.text, draft.text)
        XCTAssertEqual(fresh.source, state.exchange?.source)
        XCTAssertThrowsError(try state.saveMessageForGeneration(draft))
        XCTAssertNoThrow(try state.saveMessage(fresh, mode: .overwrite))
    }

}
