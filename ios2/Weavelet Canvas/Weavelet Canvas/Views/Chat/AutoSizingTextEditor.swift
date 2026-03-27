import SwiftUI

/// A TextEditor that sizes itself to fit its content, avoiding layout jumps
/// when switching between display and edit modes.
struct AutoSizingTextEditor: View {
    @Binding var text: String

    var body: some View {
        ZStack(alignment: .topLeading) {
            // Hidden text to measure content height
            Text(text.isEmpty ? " " : text)
                .padding(.horizontal, 5) // match TextEditor internal padding
                .padding(.vertical, 8)
                .opacity(0)
                .frame(maxWidth: .infinity, alignment: .leading)

            TextEditor(text: $text)
                .scrollContentBackground(.hidden)
        }
    }
}
