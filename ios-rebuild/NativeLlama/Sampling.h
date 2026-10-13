#include "llama.h"
#ifdef __cplusplus
extern "C" {
#endif
void * weavelet_sampler_create(const struct llama_model *, float temperature);
void weavelet_sampler_free(void *);
void weavelet_sampler_accept(void *, llama_token, bool grammar);
llama_token weavelet_sampler_sample(void *, struct llama_context *);
#ifdef __cplusplus
}
#endif
