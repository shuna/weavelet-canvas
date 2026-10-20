#include "../zstd.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static unsigned char *read_file(const char *path, size_t *size) {
    FILE *file = fopen(path, "rb"); assert(file);
    assert(fseek(file, 0, SEEK_END) == 0);
    long length = ftell(file); assert(length >= 0);
    *size = (size_t)length; rewind(file);
    unsigned char *bytes = malloc(*size + 1); assert(bytes);
    assert(fread(bytes, 1, *size, file) == *size); fclose(file); return bytes;
}
int main(int argc, char **argv) {
    assert(argc == 3);
    size_t compressed_size, expected_size;
    unsigned char *compressed = read_file(argv[1], &compressed_size);
    unsigned char *expected = read_file(argv[2], &expected_size);
    unsigned char *decoded = malloc(expected_size + 1); assert(decoded);
    assert(ZSTD_findFrameCompressedSize(compressed, compressed_size) == compressed_size);
    assert(ZSTD_getDictID_fromFrame(compressed, compressed_size) == 0);
    unsigned long long size = ZSTD_getFrameContentSize(compressed, compressed_size);
    assert(size == expected_size || size == ZSTD_CONTENTSIZE_UNKNOWN);
    size_t actual_size = ZSTD_decompress(decoded, expected_size, compressed, compressed_size);
    assert(!ZSTD_isError(actual_size)); assert(actual_size == expected_size);
    assert(memcmp(decoded, expected, expected_size) == 0);
    compressed[compressed_size - 1] ^= 1;
    assert(ZSTD_isError(ZSTD_decompress(decoded, expected_size, compressed, compressed_size)));
    free(decoded); free(expected); free(compressed);
    puts("native C: round-trip bytes and corrupted checksum rejection passed");
}
