import SwiftUI

struct BranchEditorPlaceholder: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "arrow.triangle.branch")
                .font(.system(size: 48, weight: .light))
                .foregroundStyle(.tertiary)
            Text("Branch Editor")
                .font(.title2.weight(.medium))
                .foregroundStyle(.secondary)
            Text("Visual branch editing coming soon")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
