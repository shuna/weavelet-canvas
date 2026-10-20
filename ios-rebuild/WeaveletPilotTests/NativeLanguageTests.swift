import XCTest
@testable import WeaveletPilot

@MainActor final class NativeLanguageTests: XCTestCase {
    private func preferences() -> UserDefaults {
        let suite = "native-language-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName:suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName:suite) }
        return defaults
    }

    func testLanguageChoicePersistsLocallyAndAutomaticUsesSystemNegotiation() {
        let defaults = preferences()
        let language = NativeLanguageSettings(defaults:defaults,preferredLanguages:["fr-CA"])
        XCTAssertEqual(language.selection,"")
        XCTAssertEqual(language.locale.language.languageCode?.identifier,"fr")
        XCTAssertTrue(language.select("ja"))
        XCTAssertEqual(defaults.string(forKey:NativeLanguageSettings.preferenceKey),"ja")
        let restored = NativeLanguageSettings(defaults:defaults,preferredLanguages:["en-US"])
        XCTAssertEqual(restored.selection,"ja")
        XCTAssertEqual(restored.locale.identifier,"ja")
        XCTAssertTrue(restored.select(""))
        XCTAssertNil(defaults.object(forKey:NativeLanguageSettings.preferenceKey))
        XCTAssertEqual(restored.locale.language.languageCode?.identifier,"en")
        XCTAssertEqual(restored.localized("設定"),"Settings")
    }

    func testUnsupportedChoiceCannotReplacePreferenceAndUnknownSavedChoiceUsesSystem() {
        let defaults = preferences()
        let language = NativeLanguageSettings(defaults:defaults,preferredLanguages:["pt-BR"])
        XCTAssertEqual(language.locale.language.languageCode?.identifier,"en")
        XCTAssertTrue(language.select("de"))
        XCTAssertFalse(language.select("../invalid"))
        XCTAssertEqual(language.selection,"de")
        XCTAssertEqual(language.localized("設定"),"Einstellungen")
        XCTAssertEqual(defaults.string(forKey:NativeLanguageSettings.preferenceKey),"de")
        defaults.set("unsupported",forKey:NativeLanguageSettings.preferenceKey)
        let restored = NativeLanguageSettings(defaults:defaults,preferredLanguages:["ja-JP"])
        XCTAssertEqual(restored.selection,"")
        XCTAssertEqual(restored.locale.language.languageCode?.identifier,"ja")
    }

    func testCompiledNativeCatalogReusesWebTranslations() throws {
        for (code,expected) in [("en","Save"),("ja","保存"),("de","Speichern")] {
            let path = try XCTUnwrap(Bundle.main.path(forResource:code,ofType:"lproj"))
            let bundle = try XCTUnwrap(Bundle(path:path))
            XCTAssertEqual(bundle.localizedString(forKey:"保存",value:nil,table:nil),expected)
        }
        XCTAssertEqual(Set(NativeLanguages.bundled.selectableLanguages).count,NativeLanguages.bundled.selectableLanguages.count)
    }
}
