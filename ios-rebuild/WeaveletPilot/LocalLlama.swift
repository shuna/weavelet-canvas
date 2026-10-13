import Foundation
#if targetEnvironment(macCatalyst) && arch(arm64)
import llama
#endif

struct LocalLlamaMessage: Sendable {
    let role: String
    let content: String
}
struct LocalLlamaRequest: Sendable {
    let messages: [LocalLlamaMessage]
    let assistantPrefix: String?
    let maxTokens: Int
    let temperature: Float
    var contextSize: Int? = nil
    var fallbackPrompt: String? = nil
}
enum LocalLlamaError: Error, LocalizedError {
    case unsupported, metalUnavailable, invalidRequest, modelLoad, context, template, tokenize, decode(Int32), invalidUTF8
    var errorDescription: String? {
        switch self {
        case .unsupported: return "ローカルGGUF実行はCatalyst arm64のみ対応しています"
        case .metalUnavailable: return "Metal実行デバイスが利用できません"
        case .invalidRequest: return "ローカル生成の設定または入力が不正です"
        case .modelLoad: return "GGUFモデルを読み込めませんでした"
        case .context: return "モデルのコンテキストを確保できないか、入力が長すぎます"
        case .template: return "モデルのchat templateが未対応です。共有のfallback promptが必要です"
        case .tokenize: return "モデルの入力をtokenizeできませんでした"
        case .decode(let code): return "モデルのdecodeに失敗しました (\(code))"
        case .invalidUTF8: return "モデルが不正なUTF-8を返しました"
        }
    }
}
enum LocalLlama {
    typealias Generator = @Sendable (URL, LocalLlamaRequest, @escaping @Sendable (String) async throws -> Bool) async throws -> Void
    private final class Cancellation: @unchecked Sendable {
        private let lock = NSLock()
        private var value = false
        func cancel() { lock.lock(); value = true; lock.unlock() }
        var cancelled: Bool { lock.lock(); defer { lock.unlock() }; return value }
        func check() throws { if cancelled { throw CancellationError() }; try Task.checkCancellation() }
    }
    static func generate(modelURL: URL, request: LocalLlamaRequest, onText: @escaping @Sendable (String) async throws -> Bool) async throws {
        try Task.checkCancellation()
        let cancellation = Cancellation()
        let task = Task.detached { try await run(modelURL:modelURL, request:request, cancellation:cancellation, onText:onText) }
        try await withTaskCancellationHandler(operation: { try await task.value }, onCancel: { cancellation.cancel(); task.cancel() })
    }
    private static func run(modelURL: URL, request: LocalLlamaRequest, cancellation: Cancellation, onText: @escaping @Sendable (String) async throws -> Bool) async throws {
        #if targetEnvironment(macCatalyst) && arch(arm64)
        try cancellation.check()
        guard modelURL.isFileURL, request.maxTokens >= 0, Int32(exactly:request.maxTokens) != nil, request.temperature.isFinite,
              !request.messages.contains(where: { $0.role.utf8.contains(0) || $0.content.utf8.contains(0) }),
              request.assistantPrefix?.utf8.contains(0) != true, request.fallbackPrompt?.utf8.contains(0) != true else { throw LocalLlamaError.invalidRequest }
        llama_backend_init()
        ggml_backend_load_all()
        guard ggml_backend_dev_by_type(GGML_BACKEND_DEVICE_TYPE_GPU) != nil else { throw LocalLlamaError.metalUnavailable }
        let pointer = Unmanaged.passUnretained(cancellation).toOpaque()
        var modelParams = llama_model_default_params()
        modelParams.n_gpu_layers = Int32.max
        modelParams.progress_callback_user_data = pointer
        modelParams.progress_callback = { _, raw in !Unmanaged<Cancellation>.fromOpaque(raw!).takeUnretainedValue().cancelled }
        guard let model = llama_model_load_from_file(modelURL.path, modelParams) else {
            try cancellation.check(); throw LocalLlamaError.modelLoad
        }
        defer { llama_model_free(model) }
        try cancellation.check()
        guard let vocab = llama_model_get_vocab(model) else { throw LocalLlamaError.modelLoad }
        let prompt = try formattedPrompt(model:model, request:request)
        var params = llama_context_default_params()
        let requested = request.contextSize ?? 8192
        guard requested > 0 else { throw LocalLlamaError.invalidRequest }
        params.n_ctx = UInt32(min(requested,8192,Int(llama_model_n_ctx_train(model))))
        params.abort_callback_data = pointer
        params.abort_callback = { raw in Unmanaged<Cancellation>.fromOpaque(raw!).takeUnretainedValue().cancelled }
        guard let context = llama_init_from_model(model, params) else { try cancellation.check(); throw LocalLlamaError.context }
        defer { llama_free(context) }
        var tokens = try tokenize(prompt,vocab:vocab)
        let capacity = Int(llama_n_ctx(context))
        guard !tokens.isEmpty, tokens.count <= capacity else { throw LocalLlamaError.context }
        guard let sampler = weavelet_sampler_create(model,request.temperature) else { throw LocalLlamaError.context }
        defer { weavelet_sampler_free(sampler) }
        for token in tokens { weavelet_sampler_accept(sampler,token,false) }
        let batchSize = Int(llama_n_batch(context))
        for offset in stride(from:0,to:tokens.count,by:batchSize) {
            try cancellation.check()
            let count = min(batchSize,tokens.count-offset)
            let code = tokens.withUnsafeMutableBufferPointer { buffer in
                llama_decode(context,llama_batch_get_one(buffer.baseAddress!.advanced(by:offset),Int32(count)))
            }
            try cancellation.check()
            guard code == 0 else { throw LocalLlamaError.decode(code) }
        }
        var bytes = Data()
        var usedContext = tokens.count
        for _ in 0..<request.maxTokens {
            try cancellation.check()
            var token = weavelet_sampler_sample(sampler,context)
            if llama_vocab_is_eog(vocab,token) { break }
            bytes.append(contentsOf:try piece(token,vocab:vocab))
            if let text = String(data:bytes,encoding:.utf8), try await onText(text) { return }
            try cancellation.check()
            guard usedContext < capacity else { throw LocalLlamaError.context }
            weavelet_sampler_accept(sampler,token,false)
            let code = llama_decode(context,llama_batch_get_one(&token,1))
            usedContext += 1
            try cancellation.check()
            guard code == 0 else { throw LocalLlamaError.decode(code) }
        }
        guard String(data:bytes,encoding:.utf8) != nil else { throw LocalLlamaError.invalidUTF8 }
        #else
        throw LocalLlamaError.unsupported
        #endif
    }
    #if targetEnvironment(macCatalyst) && arch(arm64)
    private static func formattedPrompt(model: OpaquePointer, request: LocalLlamaRequest) throws -> String {
        let strings = request.messages.flatMap { [strdup($0.role),strdup($0.content)] }
        defer { strings.forEach { free($0) } }
        guard !strings.contains(where: { $0 == nil }) else { throw LocalLlamaError.context }
        var messages = request.messages.indices.map { llama_chat_message(role:UnsafePointer(strings[$0*2]),content:UnsafePointer(strings[$0*2+1])) }
        if let template = llama_model_chat_template(model,nil) {
            var output = [CChar](repeating:0,count:1024)
            var count = llama_chat_apply_template(template,&messages,messages.count,true,&output,Int32(output.count))
            if count > output.count {
                output = [CChar](repeating:0,count:Int(count)+1)
                count = llama_chat_apply_template(template,&messages,messages.count,true,&output,Int32(output.count))
            }
            if count >= 0 && count <= output.count {
                let bytes = output.prefix(Int(count)).map { UInt8(bitPattern:$0) }
                guard let prompt = String(bytes:bytes,encoding:.utf8) else { throw LocalLlamaError.invalidUTF8 }
                return prompt + (request.assistantPrefix ?? "")
            }
        }
        guard let fallback = request.fallbackPrompt else { throw LocalLlamaError.template }
        return fallback
    }
    private static func tokenize(_ prompt: String, vocab: OpaquePointer) throws -> [llama_token] {
        guard let length = Int32(exactly:prompt.utf8.count) else { throw LocalLlamaError.tokenize }
        let needed = prompt.withCString { llama_tokenize(vocab,$0,length,nil,0,false,true) }
        guard needed != Int32.min else { throw LocalLlamaError.tokenize }
        var tokens = [llama_token](repeating:0,count:Int(abs(needed)))
        let count = prompt.withCString { llama_tokenize(vocab,$0,length,&tokens,Int32(tokens.count),false,true) }
        guard count >= 0 else { throw LocalLlamaError.tokenize }
        tokens = Array(tokens.prefix(Int(count)))
        // wllama action_tokenize uses add_special=false; createCompletion adds BOS only when missing.
        let bos = llama_vocab_bos(vocab)
        if llama_vocab_get_add_bos(vocab), tokens.first != bos { tokens.insert(bos,at:0) }
        return tokens
    }
    private static func piece(_ token: llama_token, vocab: OpaquePointer) throws -> [UInt8] {
        var output = [CChar](repeating:0,count:128)
        var count = llama_token_to_piece(vocab,token,&output,Int32(output.count),0,true)
        if count < 0 {
            guard count != Int32.min else { throw LocalLlamaError.invalidUTF8 }
            output = [CChar](repeating:0,count:Int(-count))
            count = llama_token_to_piece(vocab,token,&output,Int32(output.count),0,true)
        }
        guard count >= 0 else { throw LocalLlamaError.invalidUTF8 }
        return output.prefix(Int(count)).map { UInt8(bitPattern:$0) }
    }
    #endif
}
