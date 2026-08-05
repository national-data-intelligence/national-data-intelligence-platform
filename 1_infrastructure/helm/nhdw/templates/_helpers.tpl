{{/*
nhdw.image — full image ref for a component: <repository>/<name>:<tag>.
Usage: {{ include "nhdw.image" (dict "name" "internal-bi" "ctx" .) }}
e.g. nhdw/internal-bi:1.0.0 locally, registry.example.com/nhdw/internal-bi:1.0.0 in prod
— the tag is the immutable image.tag value (P2.1); repository swaps in the registry for prod.
*/}}
{{- define "nhdw.image" -}}
{{- printf "%s/%s:%s" .ctx.Values.image.repository .name .ctx.Values.image.tag -}}
{{- end -}}
