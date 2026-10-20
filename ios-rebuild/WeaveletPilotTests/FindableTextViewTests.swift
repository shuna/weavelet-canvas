import XCTest
import SwiftUI
@testable import WeaveletPilot

@MainActor final class FindableTextViewTests: XCTestCase {
    func testHighlightsPreserveUTF8AndSelectionAndRejectInvalidRanges() throws {
        let view = FindableUITextView()
        let text = "😀e\u{0301} banana"
        let ranges = [NSRange(location: 5, length: 3), NSRange(location: 7, length: 3),
                      NSRange(location: NSNotFound, length: 1), NSRange(location: 0, length: Int.max),
                      NSRange(location: -1, length: 1), NSRange(location: 0, length: 0)]
        view.configure(text: text, matches: ranges, selectedIndex: 1, font: .systemFont(ofSize: 17), dark: false, onRect: nil)
        XCTAssertTrue(view.text.utf8.elementsEqual(text.utf8))
        XCTAssertFalse(view.isEditable)
        XCTAssertTrue(view.isSelectable)
        XCTAssertFalse(view.isScrollEnabled)
        XCTAssertEqual(view.textContainerInset, .zero)
        XCTAssertEqual(view.textContainer.lineFragmentPadding, 0)
        let ordinary = try XCTUnwrap(view.textStorage.attribute(.backgroundColor, at: 5, effectiveRange: nil) as? UIColor)
        let selected = try XCTUnwrap(view.textStorage.attribute(.backgroundColor, at: 7, effectiveRange: nil) as? UIColor)
        XCTAssertNotEqual(ordinary, selected)
        XCTAssertNil(view.textStorage.attribute(.backgroundColor, at: 0, effectiveRange: nil))
        view.selectedRange = NSRange(location: 2, length: 2)
        view.configure(text: text, matches: ranges, selectedIndex: 0, font: .systemFont(ofSize: 17), dark: false, onRect: nil)
        XCTAssertEqual(view.selectedRange, NSRange(location: 2, length: 2))
        XCTAssertTrue(view.text.utf8.elementsEqual(text.utf8))
        view.configure(text: "é", matches: [], selectedIndex: -1, font: .systemFont(ofSize: 17), dark: false, onRect: nil)
        view.configure(text: "e\u{0301}", matches: [], selectedIndex: -1, font: .systemFont(ofSize: 17), dark: false, onRect: nil)
        XCTAssertTrue(view.text.utf8.elementsEqual("e\u{0301}".utf8))
    }

    func testRectRefreshesAfterWidthSelectionFontAndTextChanges() async throws {
        let view = FindableUITextView()
        let text = String(repeating: "word ", count: 30) + "target"
        let range = (text as NSString).range(of: "target")
        var result: CGRect?
        var callback: XCTestExpectation?
        let report: (CGRect?) -> Void = { result = $0; callback?.fulfill(); callback = nil }
        func update(text: String, matches: [NSRange], selected: Int = 0, width: CGFloat, font: CGFloat = 17) {
            view.configure(text: text, matches: matches, selectedIndex: selected, font: .systemFont(ofSize: font), dark: false, onRect: report)
            view.frame = CGRect(x: 0, y: 0, width: width, height: view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height)
            view.setNeedsLayout()
            view.layoutIfNeeded()
        }
        let initial = expectation(description: "initial layout")
        callback = initial
        update(text: text, matches: [range], width: 300)
        XCTAssertNil(result, "Reporting must not mutate SwiftUI state during update/layout")
        await fulfillment(of: [initial], timeout: 2)
        let wide = try XCTUnwrap(result)
        XCTAssertGreaterThan(wide.width, 0)
        let narrowReport = expectation(description: "width update")
        callback = narrowReport
        update(text: text, matches: [range], width: 100)
        await fulfillment(of: [narrowReport], timeout: 2)
        let narrow = try XCTUnwrap(result)
        XCTAssertGreaterThan(narrow.minY, wide.minY)
        let fontReport = expectation(description: "font update")
        callback = fontReport
        update(text: text, matches: [range], width: 100, font: 28)
        await fulfillment(of: [fontReport], timeout: 2)
        XCTAssertGreaterThan(try XCTUnwrap(result).height, narrow.height)
        let selectionReport = expectation(description: "selection update")
        callback = selectionReport
        update(text: text, matches: [NSRange(location: 0, length: 4), range], selected: 0, width: 100, font: 28)
        await fulfillment(of: [selectionReport], timeout: 2)
        XCTAssertEqual(try XCTUnwrap(result).minY, 0, accuracy: 1)
        let textReport = expectation(description: "text update")
        callback = textReport
        update(text: "target", matches: [NSRange(location: 0, length: 6)], width: 100)
        await fulfillment(of: [textReport], timeout: 2)
        XCTAssertEqual(try XCTUnwrap(result).minY, 0, accuracy: 1)
        let invalidReport = expectation(description: "invalid selection")
        callback = invalidReport
        update(text: "target", matches: [NSRange(location: NSNotFound, length: 1)], width: 100)
        await fulfillment(of: [invalidReport], timeout: 2)
        XCTAssertNil(result)
    }

    func testSwiftUIEnvironmentScalesBodyAndUsesLabelColor() throws {
        let host = UIHostingController(rootView: FindableTextView(text: "原文", matches: [])
            .environment(\.dynamicTypeSize, .accessibility3).environment(\.colorScheme, .dark))
        host.view.frame = CGRect(x: 0, y: 0, width: 300, height: 600)
        host.view.setNeedsLayout()
        host.view.layoutIfNeeded()
        func findTextView(_ view: UIView) -> FindableUITextView? {
            if let view = view as? FindableUITextView { return view }
            return view.subviews.lazy.compactMap { findTextView($0) }.first
        }
        let view = try XCTUnwrap(findTextView(host.view))
        let font = try XCTUnwrap(view.textStorage.attribute(.font, at: 0, effectiveRange: nil) as? UIFont)
        XCTAssertGreaterThan(font.pointSize, 17)
        let foreground = try XCTUnwrap(view.textStorage.attribute(.foregroundColor, at: 0, effectiveRange: nil) as? UIColor)
        XCTAssertEqual(foreground, UIColor.label.resolvedColor(with: UITraitCollection(userInterfaceStyle: .dark)))
    }
}
