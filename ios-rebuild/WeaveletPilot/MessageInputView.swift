import SwiftUI
import UIKit

enum EnterSubmission {
    enum Action: String { case generate, save }
    static func action(key: String, composing: Bool, control: Bool, shift: Bool, enterToSubmit: Bool, sticky: Bool) throws -> Action? {
        let result = try SharedWebOperations.call("enterSubmissionOperation", .object([
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
    let enterToSubmit: () throws -> Bool
    let submit: (EnterSubmission.Action) -> Void
    let failure: (Error) -> Void

    func makeUIView(context: Context) -> MessageInputTextView {
        let view = MessageInputTextView()
        view.delegate = context.coordinator
        view.font = .preferredFont(forTextStyle: .body)
        view.adjustsFontForContentSizeCategory = true
        view.backgroundColor = .secondarySystemBackground
        view.textColor = .label
        view.textContainerInset = UIEdgeInsets(top: 10, left: 5, bottom: 10, right: 5)
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
        let fitted = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let limit = (uiView.font?.lineHeight ?? 22) * CGFloat(maximumLines) + uiView.textContainerInset.top + uiView.textContainerInset.bottom
        return CGSize(width: width, height: max(minimumHeight, min(fitted.height, limit)))
    }
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    final class Coordinator: NSObject, UITextViewDelegate {
        var input: MessageInputView
        init(_ input: MessageInputView) { self.input = input }
        func update(_ view: MessageInputTextView) {
            let input = self.input
            view.isEditable = input.enabled
            view.accessibilityLabel = input.label
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
        }
        func textViewDidChange(_ textView: UITextView) { input.text = textView.text }
    }
}
