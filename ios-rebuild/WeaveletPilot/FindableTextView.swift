import SwiftUI
import UIKit

struct FindableTextView: UIViewRepresentable {
    let text: String
    let matches: [NSRange]
    var selectedIndex = -1
    var baseFontSize: CGFloat = 17
    var onRect: ((CGRect?) -> Void)? = nil
    @Environment(\.colorScheme) private var colorScheme
    @ScaledMetric(relativeTo: .body) private var fontSize = 17.0

    func makeUIView(context: Context) -> FindableUITextView { FindableUITextView() }
    func updateUIView(_ view: FindableUITextView, context: Context) {
        view.configure(text: text, matches: matches, selectedIndex: selectedIndex,
                       font: .systemFont(ofSize: fontSize * baseFontSize / 17), dark: colorScheme == .dark, onRect: onRect)
    }
    func sizeThatFits(_ proposal: ProposedViewSize, uiView: FindableUITextView, context: Context) -> CGSize? {
        guard let width = proposal.width else { return nil }
        return uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
    }
}

@MainActor final class FindableUITextView: UITextView {
    private var matches: [NSRange] = []
    private var selectedIndex = -1
    private var appliedFont: UIFont?
    private var dark: Bool?
    private var onRect: ((CGRect?) -> Void)?
    private var needsRect = false
    private var reportPending = false
    private var layoutWidth: CGFloat = -1

    init() {
        super.init(frame: .zero, textContainer: nil)
        isEditable = false
        isSelectable = true
        isScrollEnabled = false
        backgroundColor = .clear
        textContainerInset = .zero
        textContainer.lineFragmentPadding = 0
        setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    func configure(text: String, matches: [NSRange], selectedIndex: Int, font: UIFont, dark: Bool,
                   onRect: ((CGRect?) -> Void)?) {
        self.onRect = onRect
        needsRect = true; setNeedsLayout()
        let textChanged = !textStorage.string.utf8.elementsEqual(text.utf8)
        guard textChanged || self.matches != matches || self.selectedIndex != selectedIndex ||
                appliedFont != font || self.dark != dark else { return }
        self.matches = matches
        self.selectedIndex = selectedIndex
        appliedFont = font
        self.dark = dark
        let foreground = UIColor.label.resolvedColor(with: UITraitCollection(userInterfaceStyle: dark ? .dark : .light))
        textStorage.beginEditing()
        if textChanged { textStorage.replaceCharacters(in: NSRange(location: 0, length: textStorage.length), with: text) }
        textStorage.setAttributes([.font: font, .foregroundColor: foreground], range: NSRange(location: 0, length: textStorage.length))
        for range in matches where valid(range) {
            textStorage.addAttribute(.backgroundColor, value: UIColor.systemYellow.withAlphaComponent(dark ? 0.35 : 0.4), range: range)
        }
        if let range = selectedRangeToReport {
            textStorage.addAttribute(.backgroundColor, value: UIColor.systemOrange.withAlphaComponent(dark ? 0.55 : 0.5), range: range)
        }
        textStorage.endEditing()
        invalidateIntrinsicContentSize()
        needsRect = true
        setNeedsLayout()
    }
    private func valid(_ range: NSRange) -> Bool {
        range.location >= 0 && range.length > 0 && range.location <= textStorage.length &&
            range.length <= textStorage.length - range.location
    }
    private var selectedRangeToReport: NSRange? {
        guard matches.indices.contains(selectedIndex), valid(matches[selectedIndex]) else { return nil }
        return matches[selectedIndex]
    }
    override func layoutSubviews() {
        super.layoutSubviews()
        if layoutWidth != bounds.width { layoutWidth = bounds.width; needsRect = true }
        guard needsRect, !reportPending, bounds.width > 0 else { return }
        reportPending = true
        // SwiftUI may be updating its view tree during layout; report on the next main-queue turn.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.reportPending = false
            self.needsRect = false
            var rect: CGRect?
            if let range = self.selectedRangeToReport {
                self.layoutManager.ensureLayout(for: self.textContainer)
                let glyphs = self.layoutManager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                rect = self.layoutManager.boundingRect(forGlyphRange: glyphs, in: self.textContainer)
                    .offsetBy(dx: self.textContainerInset.left - self.contentOffset.x,
                              dy: self.textContainerInset.top - self.contentOffset.y)
            }
            self.onRect?(rect)
        }
    }
}
