{{/*
Image d'un service : <repository>/<service>:<tag>. Le tag propre au service
(image.tags.<service>, calculé par deploy.sh d'après ses seuls fichiers) prime
sur image.tag : un service inchangé garde son tag et n'est pas redémarré.
Usage : include "composmart.image" (dict "root" $ "nom" "map-api")
*/}}
{{- define "composmart.image" -}}
{{ .root.Values.image.repository }}/{{ .nom }}:{{ index (.root.Values.image.tags | default dict) .nom | default .root.Values.image.tag }}
{{- end }}

{{/* Variable lue dans le Secret. Usage : include "composmart.secretEnv" (dict "root" $ "cle" "DB_NAME" "optionnel" false) */}}
{{- define "composmart.secretEnv" -}}
- name: {{ .cle }}
  valueFrom:
    secretKeyRef:
      name: {{ .root.Values.secretName }}
      key: {{ .cle }}
      {{- if .optionnel }}
      optional: true
      {{- end }}
{{- end }}

{{/*
Variables d'environnement d'un service, d'après sa section `services.<nom>`
de values.yaml. Réutilisé tel quel par les CronJobs, seeds et tâches
ponctuelles qui tournent avec l'image de ce service.
Usage : include "composmart.env" (dict "root" $ "nom" "auth-api")
*/}}
{{- define "composmart.env" -}}
{{- $root := .root -}}
{{- $svc := index $root.Values.services .nom -}}
{{- if $svc.db }}
- { name: DB_HOST, value: {{ $svc.db | quote }} }
{{- include "composmart.secretEnv" (dict "root" $root "cle" "DB_NAME") | nindent 0 }}
{{- include "composmart.secretEnv" (dict "root" $root "cle" "DB_USER") | nindent 0 }}
{{- include "composmart.secretEnv" (dict "root" $root "cle" "DB_PASSWORD") | nindent 0 }}
{{- end }}
{{- if $svc.redis }}
- { name: REDIS_HOST, value: redis }
- { name: REDIS_PORT, value: "6379" }
{{- end }}
{{- if $svc.siteUrl }}
- { name: SITE_URL, value: {{ $root.Values.siteUrl | quote }} }
{{- end }}
{{- range $k, $v := $svc.env }}
- { name: {{ $k }}, value: {{ $v | quote }} }
{{- end }}
{{- if $svc.audit }}
{{- include "composmart.secretEnv" (dict "root" $root "cle" "AUDIT_SECRET") | nindent 0 }}
{{- end }}
{{- if $svc.smtp }}
{{- range list "SMTP_HOST" "SMTP_PORT" "SMTP_SECURE" "SMTP_USER" "SMTP_PASSWORD" "MAIL_FROM" }}
{{- include "composmart.secretEnv" (dict "root" $root "cle" . "optionnel" true) | nindent 0 }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Conteneur « tâche » (CronJob, seed, ponctuel) : image + env d'un service.
Usage : include "composmart.conteneurTache" (dict "root" $ "nom" "purge" "service" "auth-api" "command" (list ...))
*/}}
{{- define "composmart.conteneurTache" -}}
- name: {{ .nom }}
  image: {{ include "composmart.image" (dict "root" .root "nom" .service) }}
  imagePullPolicy: {{ .root.Values.image.pullPolicy }}
  command: {{ toJson .command }}
  env:
    {{- include "composmart.env" (dict "root" .root "nom" .service) | nindent 4 }}
{{- end }}

{{- define "composmart.pullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}
