#include "Sampling.h"
#include "wsampling.h"
#include <ctime>
// Use the actual pinned wllama defaults/chain; only temperature is overridden by its worker.
extern "C" void * weavelet_sampler_create(const llama_model * model, float temperature) {
    try {
        wcommon_params_sampling params;
        params.temp = temperature;
        params.seed = static_cast<uint32_t>(time(nullptr));
        return wcommon_sampler_init(model, params);
    } catch (...) { return nullptr; }
}
extern "C" void weavelet_sampler_free(void * sampler) { wcommon_sampler_free(static_cast<wcommon_sampler *>(sampler)); }
extern "C" void weavelet_sampler_accept(void * sampler, llama_token token, bool grammar) { wcommon_sampler_accept(static_cast<wcommon_sampler *>(sampler), token, grammar); }
extern "C" llama_token weavelet_sampler_sample(void * sampler, llama_context * context) { return wcommon_sampler_sample(static_cast<wcommon_sampler *>(sampler), context, -1); }
