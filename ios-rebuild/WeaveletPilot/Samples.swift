extension Conversation {
    static let samples = [
        Conversation(id: "sample-1", title: "表示と分岐のサンプル", nodes: [
            MessageNode(id: "system", parentId: nil, createdAt: 0, role: "system", content: "日本語で簡潔に回答してください。これは表示確認用のメモリ内サンプルです。"),
            MessageNode(id: "question", parentId: "system", createdAt: 1, role: "user", content: "同じ質問から生まれた、二つの回答を比べたいです。"),
            MessageNode(id: "10", parentId: "question", createdAt: 3, content: "回答Bです。分岐一覧は日時順ではなく、Webの整数key順に対応しています。表示形式を切り替えても選択した回答は保持されます。"),
            MessageNode(id: "2", parentId: "question", createdAt: 2, content: "回答Aです。メッセージ下部の分岐から別の回答を選択できます。整列表示では、アイコンと本文の左端を揃えています。\n\n長い本文も同じ領域内で折り返します。\nhttps://example.invalid/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        ], selectedLeafID: "2"),
        Conversation(id: "sample-2", title: "長文のサンプル", nodes: [
            MessageNode(id: "long-user", parentId: nil, createdAt: 0, role: "user", content: "文字を大きくしたときの読みやすさを確認します。"),
            MessageNode(id: "long-answer", parentId: "long-user", createdAt: 1, content: Array(repeating: "本文は表示領域に合わせて折り返します。狭いウインドウでも、文字を縮小せず縦に読み進められます。", count: 8).joined(separator: "\n\n"))
        ], selectedLeafID: "long-answer")
    ]
}
