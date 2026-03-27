import SwiftUI

struct ChatInputBar: View {
    @Binding var text: String
    let isGenerating: Bool
    var enterToSubmit: Bool = true
    let onSend: () -> Void
    let onStop: () -> Void

    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 10) {
                // Attachment button
                Button {
                    // placeholder: open attachment picker
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(.secondary)
                }

                // Text field - always 5 lines tall
                TextField("Message", text: $text, axis: .vertical)
                    .lineLimit(5...10)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
                    .focused($isFocused)
                    .onSubmit {
                        if enterToSubmit && canSend { onSend() }
                    }

                // Send / Stop button
                if isGenerating {
                    Button {
                        onStop()
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(.red)
                            .symbolEffect(.pulse, options: .repeating)
                    }
                } else {
                    Button {
                        onSend()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 30))
                            .foregroundStyle(canSend ? Color.accentColor : Color(.tertiaryLabel))
                    }
                    .disabled(!canSend)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 6)
            .padding(.bottom, 6)
        }
        .background {
            Rectangle().fill(.regularMaterial)
                .ignoresSafeArea(.container, edges: .bottom)
        }
    }

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
