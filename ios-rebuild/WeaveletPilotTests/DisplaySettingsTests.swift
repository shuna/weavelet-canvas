import XCTest
@testable import WeaveletPilot

final class DisplaySettingsTests: XCTestCase {
    private func store(writer: ((Data, URL) throws -> Void)? = nil) throws -> LocalStateStore {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("display-settings-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("state.json")
        return writer.map { LocalStateStore(fileURL: file, write: $0) } ?? LocalStateStore(fileURL: file)
    }
    private func fixture() throws -> OrderedJSON {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        return try OrderedJSON.decode(Data(contentsOf: root.appendingPathComponent("tests/fixtures/web-native/io-corpus.json"))).required("exportV3")
    }
    private func rawState() throws -> OrderedJSON {
        try OrderedJSON.decode(Data(#"{"theme":"future","inlineLatex":{"raw":1.2300},"markdownMode":null,"streamingMarkdownPolicy":"future","opaqueRoot":{"z":9007199254740993,"a":1.2300}}"#.utf8))
    }
    private func rawApp(_ store: LocalStateStore) throws -> ChatState {
        let state = ChatState(store: store)
        try state.importWebData(fixture().encoded())
        let snapshot = try state.publicationSnapshot()
        try state.applySnapshot(.object([.init(key: "version", value: try snapshot.required("version")),
                                       .init(key: "state", value: try rawState())]))
        return state
    }
    func testAbsentFieldsReadSharedWebDefaultsWithoutPublishing() throws {
        let state = ChatState(), defaults = try ChatImport.call("defaults")
        for field in [DisplaySetting.theme, .inlineLatex, .markdownMode, .streamingMarkdownPolicy] {
            XCTAssertEqual(try state.displaySetting(field), try defaults.required(field.rawValue))
        }
        XCTAssertThrowsError(try state.publicationSnapshot())
    }
    func testReadingUnknownValuesDoesNotNormalizeAndExplicitChoicesPreserveOtherRootsAndOrder() throws {
        let local = try store(), state = try rawApp(local)
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        for field in [DisplaySetting.theme, .inlineLatex, .markdownMode, .streamingMarkdownPolicy] {
            let value = try state.displaySetting(field)
            XCTAssertEqual(try value.encoded(), try rawState().required(field.rawValue).encoded())
            XCTAssertFalse(field.accepts(value))
        }
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        let choices: [(DisplaySetting, OrderedJSON)] = [(.theme, .string("light")), (.inlineLatex, .bool(true)),
            (.markdownMode, .bool(false)), (.streamingMarkdownPolicy, .string("never")), (.theme, .string("dark")),
            (.inlineLatex, .bool(false)), (.markdownMode, .bool(true)), (.streamingMarkdownPolicy, .string("always")),
            (.streamingMarkdownPolicy, .string("auto"))]
        for (field, value) in choices {
            let previous = try state.publicationSnapshot().required("state")
            try state.saveDisplaySetting(field, value: value)
            let current = try state.publicationSnapshot().required("state")
            XCTAssertEqual(try current.required(field.rawValue).encoded(), try value.encoded())
            XCTAssertEqual(try current.object("state").map(\.key), try previous.object("state").map(\.key))
            let oldOther = OrderedJSON.object(try previous.object("state").filter { $0.key != field.rawValue })
            let newOther = OrderedJSON.object(try current.object("state").filter { $0.key != field.rawValue })
            XCTAssertEqual(try newOther.encoded(), try oldOther.encoded())
        }
        XCTAssertEqual(try ChatState(store: local).publicationSnapshot().encoded(), try state.publicationSnapshot().encoded())
        XCTAssertEqual(try state.publicationSnapshot().required("state").required("opaqueRoot").encoded(), try rawState().required("opaqueRoot").encoded())
    }
    func testFailureAndInvalidValuesKeepPublicationAndFile() throws {
        var rejects = false
        let local = try store { data, file in
            if rejects { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: file, options: .atomic)
        }
        let state = try rawApp(local), snapshot = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        rejects = true
        for (field, value) in [(DisplaySetting.theme, OrderedJSON.string("light")), (.inlineLatex, .bool(true)),
                               (.markdownMode, .bool(true)), (.streamingMarkdownPolicy, .string("auto"))] {
            XCTAssertThrowsError(try state.saveDisplaySetting(field, value: value))
            XCTAssertEqual(try state.publicationSnapshot().encoded(), try snapshot.encoded())
            XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        }
        rejects = false
        XCTAssertThrowsError(try state.saveDisplaySetting(.theme, value: .string("system")))
        XCTAssertThrowsError(try state.saveDisplaySetting(.inlineLatex, value: .string("true")))
        XCTAssertThrowsError(try state.saveDisplaySetting(.streamingMarkdownPolicy, value: .string("future")))
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try snapshot.encoded())
        XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
    }
    func testBranchDisplayDefaultsChoicesUnknownRetentionAndSaveFailure() throws {
        let defaults = try ChatImport.call("defaults")
        XCTAssertEqual(try DisplaySettings.value(.branchSwipeDirection, in: .object([])), try defaults.required("branchSwipeDirection"))
        XCTAssertEqual(try DisplaySettings.value(.animateBubbleNavigation, in: .object([])), try defaults.required("animateBubbleNavigation"))
        XCTAssertEqual(try defaults.required("branchSwipeDirection"), .string("left-next"))
        XCTAssertEqual(try defaults.required("animateBubbleNavigation"), .bool(true))
        var rejects = false
        let local = try store { data, file in
            if rejects { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: file, options: .atomic)
        }
        let state = try rawApp(local), original = try state.publicationSnapshot()
        let unknown = try original.required("state")
            .replacing("branchSwipeDirection", with: .string("future"))
            .replacing("animateBubbleNavigation", with: .object([.init(key: "raw", value: .number("1.2300"))]))
        try state.applySnapshot(.object([.init(key: "version", value: try original.required("version")), .init(key: "state", value: unknown)]))
        let before = try state.publicationSnapshot(), disk = try Data(contentsOf: local.fileURL)
        for field in [DisplaySetting.branchSwipeDirection, .animateBubbleNavigation] {
            XCTAssertEqual(try state.displaySetting(field).encoded(), try unknown.required(field.rawValue).encoded())
            XCTAssertFalse(field.accepts(try state.displaySetting(field)))
        }
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
        rejects = true
        for (field, value) in [(DisplaySetting.branchSwipeDirection, OrderedJSON.string("right-next")), (.animateBubbleNavigation, .bool(false))] {
            XCTAssertThrowsError(try state.saveDisplaySetting(field, value: value))
            XCTAssertEqual(try state.publicationSnapshot().encoded(), try before.encoded())
            XCTAssertEqual(try Data(contentsOf: local.fileURL), disk)
        }
        rejects = false
        for (field, value) in [(DisplaySetting.branchSwipeDirection, OrderedJSON.string("right-next")), (.branchSwipeDirection, .string("left-next")), (.animateBubbleNavigation, .bool(false)), (.animateBubbleNavigation, .bool(true))] {
            let previous = try state.publicationSnapshot().required("state")
            try state.saveDisplaySetting(field, value: value)
            let current = try state.publicationSnapshot().required("state")
            XCTAssertEqual(try current.required(field.rawValue).encoded(), try value.encoded())
            XCTAssertEqual(try current.object("state").map(\.key), try previous.object("state").map(\.key))
            XCTAssertEqual(try OrderedJSON.object(current.object("state").filter { $0.key != field.rawValue }).encoded(),
                           try OrderedJSON.object(previous.object("state").filter { $0.key != field.rawValue }).encoded())
        }
        let saved = try state.publicationSnapshot()
        XCTAssertThrowsError(try state.saveDisplaySetting(.branchSwipeDirection, value: .string("future")))
        XCTAssertThrowsError(try state.saveDisplaySetting(.animateBubbleNavigation, value: .string("true")))
        XCTAssertEqual(try state.publicationSnapshot().encoded(), try saved.encoded())
        XCTAssertEqual(try ChatState(store: local).publicationSnapshot().encoded(), try saved.encoded())
    }

    func testEnterSettingUsesSharedDefaultAndKeepsUnsupportedRawValue() throws {
        let defaults = try ChatImport.call("defaults")
        XCTAssertEqual(try DisplaySettings.value(.enterToSubmit, in: .object([])), try defaults.required("enterToSubmit"))
        XCTAssertEqual(try defaults.required("enterToSubmit"), .bool(true))
        let raw = OrderedJSON.utf16String([0xd800])
        let roots = OrderedJSON.object([.init(key: "enterToSubmit", value: raw)])
        XCTAssertEqual(try DisplaySettings.value(.enterToSubmit, in: roots).encoded(), try raw.encoded())
        XCTAssertFalse(DisplaySetting.enterToSubmit.accepts(raw))
        XCTAssertTrue(DisplaySetting.enterToSubmit.accepts(.bool(false)))
    }
}
