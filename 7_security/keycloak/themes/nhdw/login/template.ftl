<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html lang="${(locale.currentLanguageTag)!'en'}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${msg("loginTitle",(realm.displayName!'NHDW'))}</title>
  <#if properties.styles?has_content>
    <#list properties.styles?split(' ') as style>
      <link href="${url.resourcesPath}/${style}" rel="stylesheet"/>
    </#list>
  </#if>
</head>
<body class="nhdw-login ${bodyClass}">
  <div class="stage">
    <div class="brand">
      <img class="brand-logo" src="${url.resourcesPath}/img/logo-fmoh.png" alt="Federal Ministry of Health emblem"/>
      <div class="brand-name">${(realm.displayName!'Ethiopia NHDW')}</div>
      <div class="brand-sub">National Health Data Warehouse</div>
    </div>

    <main class="card" role="main">
      <div class="card-head">
        <#nested "header">
      </div>

      <#-- server messages (login errors, notices) -->
      <#if displayMessage && message?? && message.summary?has_content>
        <div class="alert alert-${message.type}">
          <span>${kcSanitize(message.summary)?no_esc}</span>
        </div>
      </#if>

      <div class="card-body">
        <#nested "form">
      </div>

      <#if social?? && social.providers?? && social.providers?has_content>
        <div class="divider"><span>${msg("identity-provider-login-label")}</span></div>
        <div class="social">
          <#nested "socialProviders">
        </div>
      </#if>

      <#if displayInfo>
        <div class="card-foot">
          <#nested "info">
        </div>
      </#if>
    </main>

    <div class="stage-foot">Federal Ministry of Health · Ethiopia</div>
  </div>
</body>
</html>
</#macro>
