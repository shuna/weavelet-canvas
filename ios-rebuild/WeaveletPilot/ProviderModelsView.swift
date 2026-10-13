import SwiftUI

struct ProviderModelsView: View {
    @ObservedObject var state: ChatState
    @Binding var draft: ChatConfigDraft
    let onSelect: (ProviderModelRow) throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var providers: [ProviderDescriptor] = []
    @State private var selectedProvider = ""
    @State private var showsCredential = false
    @State private var errorMessage: String?
    @State private var refreshTask: Task<Void,Never>?
    private var provider: ProviderDescriptor? { providers.first { $0.id.utf8.elementsEqual(selectedProvider.utf8) } }
    var body: some View {
        NavigationStack {
            Form {
                Picker("provider",selection:$selectedProvider) { ForEach(providers) { Text($0.name).tag($0.id) } }.disabled(refreshTask != nil)
                if let provider {
                    Button("このproviderの端末API key") { showsCredential = true }.disabled(refreshTask != nil)
                    Button("モデル一覧を更新") { refresh(provider.id) }.disabled(refreshTask != nil || provider.modelsEndpoint == nil)
                    if refreshTask != nil { ProgressView("モデル一覧を取得中"); Button("取得を取消") { refreshTask?.cancel() } }
                    if provider.id == "cohere" { Text("Cohere固有の生成形式は未対応です。選択しても生成できません。").font(.footnote) }
                }
                rows("お気に入り",try? ProviderModels.rows(draft.modelState["favoriteModels"],providerID:selectedProvider))
                rows("取得済みモデル",try? ProviderModels.rows(draft.modelState["providerModelCache"]?[selectedProvider],providerID:selectedProvider))
                rows("カスタムモデル",try? ProviderModels.rows(draft.modelState["providerCustomModels"]?[selectedProvider],providerID:selectedProvider))
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("生成モデルを選択")
            .toolbar { ToolbarItem(placement:.cancellationAction) { Button("閉じる") { dismiss() } } }
            .task {
                do {
                    providers = try ProviderModels.providers(in:draft.snapshot.required("state"))
                    let configured = try draft.config["providerId"]?.string("provider ID") ?? ""
                    selectedProvider = providers.contains { $0.id.utf8.elementsEqual(configured.utf8) } ? configured : providers.first?.id ?? ""
                } catch { errorMessage = error.localizedDescription }
            }
            .sheet(isPresented:$showsCredential) { if let provider { ProviderCredentialView(provider:provider) } }
            .onDisappear { refreshTask?.cancel() }
        }
    }
    @ViewBuilder private func rows(_ title: String, _ models: [ProviderModelRow]?) -> some View {
        Section(title) {
            if let models, !models.isEmpty {
                ForEach(models) { row in
                    Button {
                        do { try onSelect(row); dismiss() } catch { errorMessage = error.localizedDescription }
                    } label: { VStack(alignment:.leading) { Text(row.name); Text(row.modelID).font(.caption).foregroundStyle(.secondary) } }
                    .disabled(refreshTask != nil)
                }
            } else { Text("保存されたモデルはありません").foregroundStyle(.secondary) }
        }
    }
    private func refresh(_ providerID: String) {
        errorMessage = nil
        let pending = draft
        refreshTask = Task { @MainActor in
            defer { refreshTask = nil }
            do { draft = try await state.refreshModelsForConfig(pending,providerID:providerID) }
            catch { if !Task.isCancelled { errorMessage = error.localizedDescription } }
        }
    }
}

struct ProviderCredentialView: View {
    let provider: ProviderDescriptor
    var read: ProviderModels.CredentialReader = RemoteCredentials.load(providerID:)
    var write: ProviderModels.CredentialWriter = RemoteCredentials.save(_:providerID:)
    @Environment(\.dismiss) private var dismiss
    @State private var record = RemoteCredentialRecord()
    @State private var errorMessage: String?
    var body: some View {
        NavigationStack {
            Form {
                Text(provider.name); Text(provider.endpoint).font(.caption).textSelection(.enabled)
                SecureField("このproviderのAPI key",text:$record.key)
                Text("この端末のKeychainへprovider別に保存します。取り込んだAPI keyや他providerの鍵は自動使用しません。").font(.footnote)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("端末認証設定")
            .task {
                record.settings.endpoint = provider.endpoint
                do { if let saved = try read(provider.id) { record = try ProviderModels.credential(provider,read:{ _ in saved }) } }
                catch { errorMessage = error.localizedDescription }
            }
            .toolbar {
                ToolbarItem(placement:.cancellationAction) { Button("取消") { dismiss() } }
                ToolbarItem(placement:.confirmationAction) { Button("保存") {
                    do { try ProviderModels.saveCredential(record,provider:provider,write:write); dismiss() }
                    catch { errorMessage = error.localizedDescription }
                } }
            }
        }
    }
}
