import SwiftUI

struct MessageEditBar: View {
    let message: ChatMessage
    let onSaveAndGenerate: () -> Void
    let onSave: () -> Void
    let onCancel: () -> Void
    let hasChanges: Bool

    var body: some View {
        HStack(spacing: 8) {
            splitMenuButton(
                title: "生成",
                color: .green,
                primary: onSaveAndGenerate,
                menuItems: {
                    Button { onSaveAndGenerate() } label: {
                        Label("Save & Generate", systemImage: "arrow.clockwise")
                    }
                    Button { onSave() } label: {
                        Label("Save & Branch Generate", systemImage: "arrow.triangle.branch")
                    }
                }
            )

            splitMenuButton(
                title: "再生成",
                color: .accentColor,
                primary: onSave,
                menuItems: {
                    Button { onSave() } label: {
                        Label("Overwrite Save", systemImage: "square.and.arrow.down")
                    }
                    Button { onSave() } label: {
                        Label("Save as Branch", systemImage: "arrow.triangle.branch")
                    }
                }
            )

            Button(action: onCancel) {
                Text("キャンセル")
                    .font(.subheadline.weight(.medium))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
            }
            .glassEffect(.regular.interactive())
            .clipShape(Capsule())
        }
        .frame(height: 44)
    }

    private func splitMenuButton<MenuContent: View>(
        title: String,
        icon: String? = nil,
        color: Color,
        disabled: Bool = false,
        primary: @escaping () -> Void,
        @ViewBuilder menuItems: @escaping () -> MenuContent
    ) -> some View {
        HStack(spacing: 0) {
            Button(action: primary) {
                HStack(spacing: 4) {
                    if let icon {
                        Label(title, systemImage: icon)
                    } else {
                        Text(title)
                    }
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white)
                .padding(.leading, 14)
                .padding(.trailing, 6)
                .padding(.vertical, 7)
            }
            .disabled(disabled)

            Rectangle()
                .fill(.white.opacity(0.3))
                .frame(width: 1, height: 16)

            Menu {
                menuItems()
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundStyle(.white.opacity(0.8))
                    .frame(width: 26, height: 30)
            }
        }
        .background(color, in: Capsule())
        .opacity(disabled ? 0.5 : 1.0)
    }
}
