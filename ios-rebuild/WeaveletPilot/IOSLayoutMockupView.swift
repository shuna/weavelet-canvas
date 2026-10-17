#if DEBUG
import SwiftUI

/// In-memory layout sample. No ChatState, credentials, storage, or generation services.
struct IOSLayoutMockupView: View {
    private enum InputField: Hashable { case composer, editor, search }
    @FocusState private var focusedInput: InputField?
    @State private var branch = false
    @State private var editing = false
    @State private var library = false
    @State private var searching = false
    @State private var bubbles = false
    @State private var selectedNode = 2
    @State private var model = "モデル A"
    @State private var input = ""
    @State private var query = ""
    @State private var savedText = "共有する処理\n・変換と検証\n・アプリ独自のルール\n\nネイティブに残す処理\n・UIとOS API\n・暗号と端末内保存"
    @State private var draft = ""
    @State private var notice: String?
    private let page = Color(red: 0.12, green: 0.14, blue: 0.16)
    private let surface = Color(red: 0.19, green: 0.20, blue: 0.23)
    private let titles = ["共有化の設計", "境界を整理", "共有コードを抽出", "別実装を増やす", "この方針で進める"]

    var body: some View {
        NavigationStack {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Menu {
                    ForEach(["モデル A", "モデル B"], id: \.self) { value in Button(value) { model = value } }
                } label: {
                    HStack(spacing: 6) { Text(model); Image(systemName: "chevron.down").font(.caption2) }
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(surface, in: Capsule())
                }.frame(minHeight: 44)
                Spacer(minLength: 0)
                tab(false, "bubble.left.and.bubble.right", "チャット")
                tab(true, "point.3.connected.trianglepath.dotted", "分岐図")
                Menu {
                    Toggle("吹き出し表示", isOn: $bubbles)
                    Button("分割表示") { unconnected("分割表示") }
                    Button("設定") { unconnected("設定") }
                } label: { Image(systemName: "line.3.horizontal").frame(width: 44, height: 44) }
                    .accessibilityLabel("表示設定")
            }
            .padding(.horizontal, 12)
            .buttonStyle(.plain)
            Divider()
            if searching {
                HStack {
                    TextField(branch ? "分岐を検索" : "会話内を検索", text: $query)
                        .focused($focusedInput, equals: .search)
                    Button("閉じる") { focusedInput = nil; searching = false }
                }.padding(12).background(surface)
                Text("検索結果の接続は後続工程です").font(.caption).foregroundStyle(.secondary).padding(.bottom, 6)
            }
            if branch { graph } else { stream }
        }
        .background(page)
        .navigationTitle("共有化の設計")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarLeading) {
                Button("会話一覧", systemImage: "sidebar.left") { library = true }.labelStyle(.iconOnly)
                Button("戻る", systemImage: "chevron.left") { unconnected("戻る") }.labelStyle(.iconOnly)
                Button("進む", systemImage: "chevron.right") { unconnected("進む") }.labelStyle(.iconOnly)
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button("検索", systemImage: "magnifyingglass") { searching.toggle() }.labelStyle(.iconOnly)
                Button("新規会話", systemImage: "square.and.pencil") { unconnected("新規会話") }.labelStyle(.iconOnly)
            }
            ToolbarItemGroup(placement: .keyboard) {
                if focusedInput != .search {
                    Button("添付", systemImage: "plus") { unconnected("添付") }.labelStyle(.iconOnly)
                    Button("プロンプト", systemImage: "text.badge.plus") { unconnected("プロンプト") }.labelStyle(.iconOnly)
                }
                Spacer()
                Button("キーボードを閉じる", systemImage: "keyboard.chevron.compact.down") { focusedInput = nil }.labelStyle(.iconOnly)
            }
        }
        .onChange(of: branch) { _, _ in focusedInput = nil }
        .onChange(of: searching) { _, visible in focusedInput = visible ? .search : nil }
        }
        .foregroundStyle(.white)
        .background(page)
        .preferredColorScheme(.dark)
        .frame(maxWidth: 393, maxHeight: 852)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black)
        .sheet(isPresented: $library) { libraryView }
        .alert("UIモックアップ", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
            Button("閉じる", role: .cancel) { notice = nil }
        } message: { Text(notice ?? "") }
    }

    private func unconnected(_ action: String) { notice = "「\(action)」の機能は未接続です。表示用の合成データを使用しています。" }
    private func icon(_ name: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) { Image(systemName: name).font(.system(size: 17)).frame(width: 44, height: 44) }
            .accessibilityLabel(label)
            .buttonStyle(.plain)
    }
    private func tab(_ value: Bool, _ name: String, _ label: String) -> some View {
        Button { branch = value } label: {
            Image(systemName: name).frame(width: 44, height: 44)
                .foregroundStyle(branch == value ? Color.blue : .gray)
                .overlay(alignment: .bottom) { if branch == value { Rectangle().fill(.blue).frame(height: 2) } }
        }.buttonStyle(.plain).accessibilityLabel(label).accessibilityAddTraits(branch == value ? .isSelected : [])
    }
    private func header(_ assistant: Bool) -> some View {
        HStack(spacing: 7) {
            Text(assistant ? "A" : "U").font(.headline).frame(width: 30, height: 30)
                .background(assistant ? Color.teal : .red, in: RoundedRectangle(cornerRadius: 6))
                .accessibilityHidden(true)
            Text(assistant ? "アシスタント" : "ユーザー").font(.subheadline.weight(.semibold))
            Spacer(minLength: 0)
            Menu {
                Button("原文") {}
                Button("要約") { unconnected("要約") }
            } label: {
                HStack(spacing: 3) { Text("原文"); Image(systemName: "chevron.down").font(.caption2) }
                    .font(.caption).frame(minWidth: 44, minHeight: 44)
            }.accessibilityLabel("表示形式")
            if assistant {
                icon("checkmark.seal", "評価") { unconnected("評価") }
                icon("eye.slash", "文脈から除外") { unconnected("文脈から除外") }
                icon("shield", "保護") { unconnected("保護") }
            }
        }
    }
    private func userRow(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            header(false)
            Text(text).font(.body).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(bubbles ? surface : Color.white.opacity(0.025))
        .clipShape(RoundedRectangle(cornerRadius: bubbles ? 18 : 0))
        .padding(.leading, bubbles ? 24 : 0)
    }
    private var stream: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 0) {
                    userRow("共有処理とネイティブ処理の境界を整理してください。").id("top")
                    VStack(alignment: .leading, spacing: 6) {
                        header(true)
                        if editing {
                            TextField("本文", text: $draft, axis: .vertical)
                                .lineLimit(1...10)
                                .font(.body).lineSpacing(4)
                                .focused($focusedInput, equals: .editor)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12).background(surface, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(RoundedRectangle(cornerRadius: 12).stroke(.blue))
                                .accessibilityLabel("本文を編集")
                                .onAppear { focusedInput = .editor }
                            editButtons.id("editorControls")
                        } else {
                            Text(savedText).font(.body).lineSpacing(4).textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(12).background(surface, in: RoundedRectangle(cornerRadius: 12))
                            HStack(spacing: 0) {
                                icon("chevron.left", "前の分岐") { unconnected("前の分岐") }
                                Text("1/2").font(.caption)
                                icon("chevron.right", "次の分岐") { unconnected("次の分岐") }
                                Spacer(minLength: 0)
                                icon("pencil", "編集") { draft = savedText; editing = true }
                                icon("arrow.clockwise", "再生成") { unconnected("再生成") }
                                icon("doc.on.doc", "コピー") { unconnected("コピー") }
                            }
                        }
                    }.padding(.horizontal, 16).padding(.vertical, 8)
                        .padding(.trailing, bubbles ? 24 : 0)
                    userRow("この方針で、想定されるメリットと注意点も教えてください。")
                    HStack(spacing: 0) {
                        Spacer()
                        icon("arrow.up", "最初へ") { proxy.scrollTo("top", anchor: .top) }
                        icon("arrow.down", "入力欄へ") { proxy.scrollTo("composer", anchor: .bottom) }
                    }.padding(.horizontal, 12)
                    composer.id("composer")
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: focusedInput) { _, field in
                if let field, field != .search {
                    withAnimation { proxy.scrollTo(field == .editor ? "editorControls" : "composer", anchor: .bottom) }
                }
            }
        }
    }
    private var editButtons: some View {
        HStack(spacing: 8) {
            Button { focusedInput = nil; editing = false } label: {
                Text("取消").frame(minWidth: 44, minHeight: 44, alignment: .leading).contentShape(Rectangle())
            }
            Spacer(minLength: 0)
            Button { unconnected("分岐保存") } label: {
                Text("分岐保存").frame(minWidth: 44, minHeight: 44).contentShape(Rectangle())
            }
            Button { savedText = draft; focusedInput = nil; editing = false } label: {
                Text("保存").padding(.horizontal, 14).frame(minWidth: 44, minHeight: 44)
                    .background(.blue, in: RoundedRectangle(cornerRadius: 8))
            }
        }.buttonStyle(.plain).font(.subheadline).frame(minHeight: 44)
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("ユーザー ▾").font(.caption.weight(.semibold)).padding(.horizontal, 6)
            TextField("メッセージを入力", text: $input, axis: .vertical).lineLimit(1...5)
                .focused($focusedInput, equals: .composer)
                .padding(10).background(surface, in: RoundedRectangle(cornerRadius: 10))
                .accessibilityLabel("メッセージを入力")
            HStack(spacing: 0) {
                icon("plus", "添付") { unconnected("添付") }
                Button { unconnected("プロンプト") } label: { Text("/").frame(width: 44, height: 44) }.accessibilityLabel("プロンプト")
                icon("slider.horizontal.3", "生成設定") { unconnected("生成設定") }
                Spacer()
                icon("arrow.up.circle.fill", "送信") { unconnected("送信") }.foregroundStyle(.blue)
            }
        }.padding(12).background(page)
            .overlay(alignment: .top) { Divider() }
    }

    private var graph: some View {
        GeometryReader { geometry in
            ScrollView([.vertical, .horizontal]) {
                let width = max(geometry.size.width, 360)
                let centers = [CGPoint(x: width / 2, y: 64), CGPoint(x: width / 2, y: 190), CGPoint(x: width * 0.26, y: 326), CGPoint(x: width * 0.74, y: 326), CGPoint(x: width * 0.26, y: 472)]
                ZStack(alignment: .topLeading) {
                    Path { path in
                        for (from, to) in [(0, 1), (1, 2), (1, 3), (2, 4)] {
                            let a = centers[from], b = centers[to]
                            path.move(to: CGPoint(x: a.x, y: a.y + 43))
                            path.addLine(to: CGPoint(x: a.x, y: (a.y + b.y) / 2))
                            path.addLine(to: CGPoint(x: b.x, y: (a.y + b.y) / 2))
                            path.addLine(to: CGPoint(x: b.x, y: b.y - 43))
                        }
                    }.stroke(.gray, lineWidth: 1.5)
                    ForEach(titles.indices, id: \.self) { index in
                        Button { selectedNode = index } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Label(titles[index], systemImage: index == 0 ? "doc.text" : index == 1 || index == 4 ? "person.fill" : "sparkles")
                                    .font(.caption.weight(.semibold)).lineLimit(2)
                                Text(index == 2 ? "変換・検証・アプリ独自ルール" : "設計の方針を確認する").font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                            }.padding(10).frame(width: 164, height: 86, alignment: .leading)
                                .background(surface, in: RoundedRectangle(cornerRadius: 10))
                                .overlay(RoundedRectangle(cornerRadius: 10).stroke(selectedNode == index ? .blue : .gray, lineWidth: selectedNode == index ? 2 : 1))
                        }.position(centers[index]).accessibilityAddTraits(selectedNode == index ? .isSelected : [])
                    }
                }.frame(width: width, height: 550)
            }
        }
        .overlay(alignment: .bottomLeading) {
            HStack(spacing: 0) {
                icon("minus", "縮小") { unconnected("縮小") }
                icon("plus", "拡大") { unconnected("拡大") }
                icon("arrow.up.left.and.arrow.down.right", "全体表示") { unconnected("全体表示") }
            }.background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 8)).padding(12)
        }
    }
    private var libraryView: some View {
        NavigationStack {
            List {
                ForEach(["共有化の設計", "UIレイアウト", "同期方式の確認"], id: \.self) { title in
                    Button { library = false } label: { Label(title, systemImage: "bubble.left") }
                }
                Section("この画面について") { Text("合成データだけを使うUIモックです。実データ・同期・生成には接続していません。").font(.footnote) }
            }
            .navigationTitle("会話")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("閉じる") { library = false } } }
        }.preferredColorScheme(.dark)
    }
}
#endif
