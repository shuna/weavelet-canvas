import SwiftUI
import UIKit

@MainActor enum EnterSubmission {
    enum Action: String { case generate, save }
    private static var session: SharedWebOperations.Session?
    static func action(key: String, composing: Bool, control: Bool, shift: Bool, enterToSubmit: Bool, sticky: Bool) throws -> Action? {
        if session == nil { session = try SharedWebOperations.Session() }
        let result = try session!.call("enterSubmissionOperation", .object([
            .init(key: "key", value: .string(key)), .init(key: "isComposing", value: .bool(composing)),
            .init(key: "keyCode", value: .number(composing ? "229" : "13")), .init(key: "isMobile", value: .bool(false)),
            .init(key: "ctrlKey", value: .bool(control)), .init(key: "shiftKey", value: .bool(shift)),
            .init(key: "enterToSubmit", value: .bool(enterToSubmit)), .init(key: "sticky", value: .bool(sticky))]))
        if result["action"] == .null { return nil }
        guard let action = Action(rawValue: try result.required("action").string("submission action")) else {
            throw ExchangeError.invalid("入力操作が正しくありません")
        }
        return action
    }
}

final class MessageInputTextView: UITextView {
    var submission: ((String, Bool, Bool, Bool) -> Bool)?
    var commandAvailable: ((UIKeyModifierFlags) -> Bool)?
    // Catalyst text input may bypass pressesBegan; register only shared submission actions.
    override var keyCommands: [UIKeyCommand]? {
        var commands = super.keyCommands ?? []
        guard isEditable, markedTextRange == nil else { return commands }
        for modifiers: UIKeyModifierFlags in [[], .shift, .control, [.control, .shift]] where commandAvailable?(modifiers) == true {
            let command = UIKeyCommand(input: "\r", modifierFlags: modifiers, action: #selector(submitHardwareReturn(_:)))
            command.wantsPriorityOverSystemBehavior = true
            commands.append(command)
        }
        return commands
    }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(submitHardwareReturn(_:)) { return isEditable && markedTextRange == nil }
        return super.canPerformAction(action, withSender: sender)
    }
    @objc private func submitHardwareReturn(_ command: UIKeyCommand) {
        guard markedTextRange == nil else { return }
        _ = handleHardwareKey("Enter", modifiers: command.modifierFlags)
    }
    // Read marked text before UIKit processes the key that confirms the IME candidate.
    func handleHardwareKey(_ key: String, modifiers: UIKeyModifierFlags) -> Bool {
        guard isEditable else { return false }
        return submission?(key, markedTextRange != nil, modifiers.contains(.control), modifiers.contains(.shift)) ?? false
    }
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let remaining = presses.filter { press in
            guard let key = press.key, key.keyCode == .keyboardReturnOrEnter || key.keyCode == .keypadEnter else { return true }
            return !handleHardwareKey("Enter", modifiers: key.modifierFlags)
        }
        if !remaining.isEmpty { super.pressesBegan(Set(remaining), with: event) }
    }
}

struct MessageInputView: UIViewRepresentable {
    @Binding var text: String
    let label: String
    let enabled: Bool
    let sticky: Bool
    var minimumHeight: CGFloat = 44
    var maximumLines: Int = 8
    var fillsAvailableHeight = false
    var textInsets = UIEdgeInsets(top: 10, left: 5, bottom: 10, right: 5)
    var focused: Binding<Bool>? = nil
    let enterToSubmit: () throws -> Bool
    let submit: (EnterSubmission.Action) -> Void
    let failure: (Error) -> Void

    func makeUIView(context: Context) -> MessageInputTextView {
        let view = MessageInputTextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .clear
        view.textColor = .label
        view.textContainerInset = textInsets
        view.layer.cornerRadius = 6
        view.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        updateUIView(view, context: context)
        return view
    }
    func updateUIView(_ view: MessageInputTextView, context: Context) {
        context.coordinator.input = self
        context.coordinator.update(view)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: MessageInputTextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        if fillsAvailableHeight, let height = proposal.height, height.isFinite {
            return CGSize(width:width,height:max(0,height))
        }
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let limit = (uiView.font?.lineHeight ?? 22) * CGFloat(maximumLines) + uiView.textContainerInset.top + uiView.textContainerInset.bottom
        return CGSize(width: width, height: max(minimumHeight, min(fitted.height, limit)))
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    @MainActor final class Coordinator: NSObject, UITextViewDelegate {
        var input: MessageInputView
        init(_ input: MessageInputView) { self.input = input }
        func update(_ view: MessageInputTextView) {
            let input = self.input
            view.isEditable = input.enabled
            view.accessibilityLabel = input.label
            view.commandAvailable = { [weak self] modifiers in
                guard let input = self?.input, input.enabled else { return false }
                return (try? EnterSubmission.action(key: "Enter", composing: false,
                    control: modifiers.contains(.control), shift: modifiers.contains(.shift),
                    enterToSubmit: input.enterToSubmit(), sticky: input.sticky)) != nil
            }
            view.submission = { [weak self] key, composing, control, shift in
                guard let input = self?.input, input.enabled else { return false }
                do {
                    guard let action = try EnterSubmission.action(key: key, composing: composing, control: control, shift: shift,
                        enterToSubmit: input.enterToSubmit(), sticky: input.sticky) else { return false }
                    input.submit(action)
                    return true
                } catch { input.failure(error); return true }
            }
            if !view.text.utf8.elementsEqual(input.text.utf8) && view.markedTextRange == nil {
                let selection = view.selectedRange
                view.text = input.text
                let count = (input.text as NSString).length
                view.selectedRange = NSRange(location: min(selection.location, count), length: min(selection.length, max(0, count - selection.location)))
            }
            if let focused = input.focused {
                if focused.wrappedValue && !view.isFirstResponder && view.window != nil { view.becomeFirstResponder() }
                else if !focused.wrappedValue && view.isFirstResponder { view.resignFirstResponder() }
            }
        }
        func textViewDidChange(_ textView: UITextView) { input.text = textView.text }
        func textViewDidBeginEditing(_ textView: UITextView) {
            if input.focused?.wrappedValue == false { input.focused?.wrappedValue = true }
        }
        func textViewDidEndEditing(_ textView: UITextView) {
            if input.focused?.wrappedValue == true { input.focused?.wrappedValue = false }
        }
    }
}
