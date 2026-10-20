import Foundation
import SwiftUI

struct NativeLanguages: Decodable {
    let i18nLanguages: [String]
    let selectableLanguages: [String]
    let languageCodeToName: [String:String]
    let fallbackLanguage: String

    static let bundled: NativeLanguages = {
        guard let url = Bundle.main.url(forResource:"WebLanguages",withExtension:"json"),
              let data = try? Data(contentsOf:url),
              let value = try? JSONDecoder().decode(NativeLanguages.self,from:data),
              value.i18nLanguages.contains(value.fallbackLanguage),
              value.selectableLanguages.allSatisfy({ value.i18nLanguages.contains($0) && value.languageCodeToName[$0] != nil }) else {
            preconditionFailure("Missing or invalid bundled Web languages")
        }
        return value
    }()
}

@MainActor final class NativeLanguageSettings: ObservableObject {
    static let preferenceKey = "native.displayLanguage"
    @Published private(set) var selection: String
    let languages: NativeLanguages
    private let defaults: UserDefaults
    private let preferredLanguages: [String]

    init(defaults: UserDefaults = .standard, preferredLanguages: [String] = Locale.preferredLanguages, languages: NativeLanguages = .bundled) {
        self.defaults = defaults; self.preferredLanguages = preferredLanguages; self.languages = languages
        let saved = defaults.string(forKey:Self.preferenceKey) ?? ""
        selection = languages.selectableLanguages.contains(saved) ? saved : ""
    }

    var locale: Locale {
        if !selection.isEmpty { return Locale(identifier:selection) }
        let available = [languages.fallbackLanguage] + languages.i18nLanguages.filter { $0 != languages.fallbackLanguage }
        return Locale(identifier:Bundle.preferredLocalizations(from:available,forPreferences:preferredLanguages).first ?? languages.fallbackLanguage)
    }

    // UIKit-backed navigation titles cache SwiftUI Text localization while presented.
    func localized(_ key: String) -> String {
        nativeLocalizedString(key,locale:locale)
    }

    @discardableResult func select(_ code: String) -> Bool {
        guard code.isEmpty || languages.selectableLanguages.contains(code) else { return false }
        if code.isEmpty { defaults.removeObject(forKey:Self.preferenceKey) }
        else { defaults.set(code,forKey:Self.preferenceKey) }
        selection = code
        return true
    }
}

struct NativeLanguagePicker: View {
    @EnvironmentObject private var language: NativeLanguageSettings
    var body: some View {
        Picker("言語",selection:Binding(get:{ language.selection },set:{ code in
            // Picker tags come exclusively from the bundled selectable set.
            language.select(code)
        })) {
            Text("自動").tag("")
            ForEach(language.languages.selectableLanguages,id:\.self) { code in
                Text(verbatim:language.languages.languageCodeToName[code] ?? code).tag(code)
            }
        }
    }
}

private func nativeLocalizedString(_ key: String, locale: Locale) -> String {
    let code = Bundle.preferredLocalizations(from:Bundle.main.localizations,forPreferences:[locale.identifier]).first ?? NativeLanguages.bundled.fallbackLanguage
    guard let path = Bundle.main.path(forResource:code,ofType:"lproj"), let bundle = Bundle(path:path) else { return key }
    return bundle.localizedString(forKey:key,value:nil,table:nil)
}

private struct NativeNavigationTitle: ViewModifier {
    @Environment(\.locale) private var locale
    let key: String
    func body(content: Content) -> some View {
        content.navigationTitle(nativeLocalizedString(key,locale:locale))
    }
}

extension View {
    func nativeNavigationTitle(_ key: String) -> some View {
        modifier(NativeNavigationTitle(key:key))
    }
}
