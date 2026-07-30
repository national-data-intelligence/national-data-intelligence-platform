{{/*
nhdw.image — full image ref for a component: <repository>/<name>:<tag>.
Usage: {{ include "nhdw.image" (dict "name" "internal-bi" "ctx" .) }}
dev → nhdw/internal-bi:dev ; prod → registry.example.com/nhdw/internal-bi:1.0.0
*/}}
{{- define "nhdw.image" -}}
{{- printf "%s/%s:%s" .ctx.Values.image.repository .name .ctx.Values.image.tag -}}
{{- end -}}
