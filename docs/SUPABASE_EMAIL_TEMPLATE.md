# Template de E-mail — Redefinição de Senha (Supabase)

Este documento contém o template HTML profissional para o e-mail de redefinição de senha enviado pelo Supabase Auth, além do passo a passo para configurá-lo no dashboard.

---

## Como configurar no Supabase Dashboard

1. Acesse [https://supabase.com/dashboard](https://supabase.com/dashboard) e abra o projeto do **PontoFácil**.
2. No menu lateral, clique em **Authentication**.
3. Clique em **Email Templates**.
4. Selecione a aba **Reset Password**.
5. No campo **Subject**, substitua pelo assunto abaixo.
6. No campo **Body**, apague o conteúdo padrão e cole o template HTML abaixo.
7. Clique em **Save**.

> **Variáveis disponíveis pelo Supabase:**
> - `{{ .ConfirmationURL }}` — link completo de redefinição de senha (gerado pelo Supabase).
> - `{{ .Email }}` — endereço de e-mail do usuário que solicitou o reset.
> - `{{ .SiteURL }}` — URL base do projeto configurada em **Authentication → URL Configuration**.

---

## Assunto (Subject)

```
PontoFácil — Redefinição de senha
```

---

## Template HTML

Copie e cole o bloco abaixo integralmente no campo **Body** do Supabase:

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Redefinição de senha — PontoFácil</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset básico */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background-color: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; -webkit-text-size-adjust: 100%; }
    a { color: #1D9E75; text-decoration: none; }
    img { border: 0; display: block; }

    /* Responsividade */
    @media only screen and (max-width: 600px) {
      .email-wrapper { padding: 12px 8px !important; }
      .email-card { border-radius: 10px !important; }
      .email-body { padding: 24px 18px !important; }
      .btn-reset { display: block !important; text-align: center !important; }
    }
  </style>
</head>
<body style="background-color:#f4f6f8;margin:0;padding:0;">

  <!-- Wrapper externo -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:#f4f6f8;">
    <tr>
      <td align="center" class="email-wrapper" style="padding:32px 16px;">

        <!-- Card principal -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               class="email-card"
               style="max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">

          <!-- Cabeçalho com gradiente -->
          <tr>
            <td style="background:linear-gradient(135deg,#1D9E75 0%,#085041 100%);padding:22px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:0.3px;margin:0;">
                      PontoFácil
                    </p>
                    <p style="color:rgba(255,255,255,0.88);font-size:13px;margin:3px 0 0 0;">
                      Controle de ponto simplificado
                    </p>
                  </td>
                  <td align="right" valign="middle">
                    <!-- Ícone de cadeado em SVG inline (sem dependência externa) -->
                    <div style="width:42px;height:42px;background:rgba(255,255,255,0.18);border-radius:50%;display:inline-flex;align-items:center;justify-content:center;">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                           xmlns="http://www.w3.org/2000/svg" style="display:block;">
                        <rect x="3" y="11" width="18" height="11" rx="2" fill="white" fill-opacity="0.9"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" stroke="white" stroke-width="2"
                              stroke-linecap="round" fill="none"/>
                        <circle cx="12" cy="16" r="1.5" fill="#1D9E75"/>
                      </svg>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Corpo do e-mail -->
          <tr>
            <td class="email-body" style="padding:30px 28px;color:#111827;">

              <!-- Saudação -->
              <p style="font-size:15px;font-weight:600;color:#111827;margin:0 0 6px 0;">
                Olá! 👋
              </p>
              <p style="font-size:13.5px;color:#6b7280;margin:0 0 20px 0;">
                {{ .Email }}
              </p>

              <!-- Mensagem principal -->
              <p style="font-size:15px;line-height:1.65;color:#374151;margin:0 0 10px 0;">
                Recebemos uma solicitação para <strong>redefinir a senha</strong> da sua conta no PontoFácil.
              </p>
              <p style="font-size:14px;line-height:1.65;color:#374151;margin:0 0 26px 0;">
                Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>.
              </p>

              <!-- Botão CTA -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 26px 0;">
                <tr>
                  <td style="border-radius:10px;background:#1D9E75;">
                    <a href="{{ .ConfirmationURL }}"
                       class="btn-reset"
                       style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;
                              color:#ffffff;text-decoration:none;border-radius:10px;
                              background:#1D9E75;letter-spacing:0.2px;">
                      Redefinir minha senha
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Aviso de segurança -->
              <div style="background:#f0fdf8;border:1px solid #bbf7e0;border-radius:10px;padding:14px 16px;margin:0 0 24px 0;">
                <p style="font-size:13px;line-height:1.6;color:#065f46;margin:0;">
                  🔒 <strong>Não solicitou a redefinição?</strong><br/>
                  Ignore este e-mail com segurança. Sua senha permanece a mesma e nenhuma alteração será feita.
                </p>
              </div>

              <!-- Link alternativo (fallback) -->
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin:0 0 24px 0;">
                <p style="font-size:12.5px;color:#6b7280;margin:0 0 6px 0;">
                  Se o botão não funcionar, copie e cole o link abaixo no seu navegador:
                </p>
                <p style="font-size:12px;color:#374151;word-break:break-all;margin:0;">
                  <a href="{{ .ConfirmationURL }}" style="color:#1D9E75;">
                    {{ .ConfirmationURL }}
                  </a>
                </p>
              </div>

              <!-- Divisor -->
              <hr style="border:none;border-top:1px solid #f0f0f0;margin:0 0 20px 0;" />

              <!-- Nota de expiração -->
              <p style="font-size:12.5px;line-height:1.6;color:#9ca3af;margin:0;">
                Por segurança, este link expira em <strong>1 hora</strong>. Após esse prazo, solicite uma nova redefinição de senha na tela de login.
              </p>

            </td>
          </tr>

          <!-- Rodapé do card -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #f0f0f0;padding:16px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <p style="font-size:12px;color:#9ca3af;margin:0;">
                      <strong style="color:#6b7280;">PontoFácil</strong> &mdash; Controle de ponto simplificado
                    </p>
                    <p style="font-size:12px;color:#9ca3af;margin:4px 0 0 0;">
                      <a href="https://pontofacil.digital" style="color:#1D9E75;">pontofacil.digital</a>
                    </p>
                  </td>
                  <td align="right" valign="middle">
                    <p style="font-size:11px;color:#d1d5db;margin:0;">
                      E-mail automático
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Card principal -->

        <!-- Aviso externo ao card -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
               style="max-width:560px;">
          <tr>
            <td style="padding:14px 4px 0 4px;text-align:center;">
              <p style="font-size:11.5px;color:#9ca3af;line-height:1.5;margin:0;">
                Você está recebendo este e-mail porque uma redefinição de senha foi solicitada para a conta associada a <strong>{{ .Email }}</strong>.<br/>
                Se não foi você, nenhuma ação é necessária.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>
  <!-- /Wrapper externo -->

</body>
</html>
```

---

## Texto simples (Plain Text Fallback)

Alguns clientes de e-mail não renderizam HTML. Cole o texto abaixo no campo **Plain Text** (se disponível no Supabase):

```
PontoFácil — Redefinição de senha
==================================

Olá!

Recebemos uma solicitação para redefinir a senha da conta: {{ .Email }}

Para criar uma nova senha, acesse o link abaixo:
{{ .ConfirmationURL }}

Este link é válido por 1 hora.

Se você não solicitou a redefinição de senha, ignore este e-mail.
Sua senha permanece a mesma e nenhuma alteração será feita.

---
PontoFácil — pontofacil.digital
E-mail enviado automaticamente. Não responda a esta mensagem.
```

---

## Observações técnicas

| Item | Detalhe |
|---|---|
| Variável do link | `{{ .ConfirmationURL }}` — gerada automaticamente pelo Supabase com o `redirectTo` configurado no backend (`https://pontofacil.digital/redefinir-senha`). |
| Variável do e-mail | `{{ .Email }}` — endereço do usuário que solicitou o reset. |
| Cor primária | `#1D9E75` (verde PontoFácil). |
| Validade do link | Configurável em **Authentication → Email → JWT expiry** no Supabase (padrão: 1 hora). |
| Responsividade | Template usa `max-width: 560px` com media queries para mobile. |
| Compatibilidade | Estrutura em `<table>` para máxima compatibilidade com clientes de e-mail (Gmail, Outlook, Apple Mail). |

---

## Onde o backend aciona o envio

O envio é disparado em `src/services/supabaseAuth.service.js` → função `sendPasswordResetEmail`, chamada pelo controller `src/controllers/auth.controller.js` → `esqueciSenhaSupabase`.

O `redirectTo` enviado ao Supabase é construído a partir da variável de ambiente `FRONTEND_URL`:

```
https://pontofacil.digital/redefinir-senha
```

Certifique-se de que essa URL está na lista de **Redirect URLs** permitidas em **Authentication → URL Configuration** no Supabase Dashboard.
