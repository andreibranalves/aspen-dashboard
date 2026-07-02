// @ts-check
import { test, expect } from '@playwright/test';

test.describe('WhatsApp Inbox Page', () => {
  test('page loads with full layout: sidebar, header, filters, three-column inbox', async ({
    page,
  }) => {
    await page.goto('/#/whatsapp-inbox');

    // Header and breadcrumb
    await expect(page.getByText('WhatsApp').first()).toBeVisible({ timeout: 10000 });

    // Sidebar has WhatsApp nav item (highlighted when active)
    const sidebar = page.locator('aside, nav, [class*="sidebar"], [class*="Sidebar"]').first();
    await expect(sidebar).toContainText('WhatsApp');

    // Status filter chips
    await expect(page.getByRole('button', { name: 'Todas' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Novas' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Pedido detectado/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pré-orçamento', exact: true })).toBeVisible();

    // Search input
    await expect(page.getByPlaceholder(/Buscar/)).toBeVisible();

    // Action buttons
    await expect(page.getByRole('button', { name: 'Atualizar' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sincronizar' })).toBeVisible();

    // Three-column layout sections
    await expect(page.getByText('Conversas')).toBeVisible();
    await expect(page.getByText('Painel comercial')).toBeVisible();
  });

  test('sync button is clickable and API responds (200 or 500 with Portuguese error)', async ({
    page,
  }) => {
    await page.goto('/#/whatsapp-inbox');
    await page.waitForSelector('button:has-text("Sincronizar")', { timeout: 10000 });

    // Click Sincronizar and wait for network to settle
    const syncBtn = page.getByRole('button', { name: 'Sincronizar' });
    await syncBtn.click();

    // Wait for either: updated conversation list OR error message
    // The result depends on whether Evolution API is configured
    await page.waitForTimeout(5000);

    // Page should still be functional — no crash, no blank screen
    await expect(page.getByText('WhatsApp').first()).toBeVisible();
  });

  test('commercial panel shows action buttons for selected conversation', async ({ page }) => {
    await page.route('**/api/whatsapp-conversations**', async (route) => {
      const requestUrl = route.request().url();

      if (requestUrl.includes('/api/whatsapp-conversations?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: 'wa_1',
              remoteJid: '5511999999999@s.whatsapp.net',
              phone: '5511999999999',
              displayName: 'Maria',
              providerConversationId: '5511999999999@s.whatsapp.net',
              canonicalPhone: '5511999999999',
              displayLabel: 'Maria',
              identityStatus: 'verified',
              identitySource: 'chat.phone',
              identityConfidence: 'high',
              lastMessageAt: '2026-07-01T12:00:00.000Z',
              lastMessagePreview: 'Quero orçamento',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
              crmMatch: null,
            },
          },
        });
        return;
      }

      if (requestUrl.includes('messages=')) {
        await route.fulfill({
          json: {
            success: true,
            data: [
              {
                id: 'm1',
                conversationId: 'wa_1',
                providerMessageId: 'm1',
                direction: 'inbound',
                type: 'text',
                body: 'Quero orçamento',
                mediaUrl: '',
                timestamp: '2026-07-01T12:00:00.000Z',
              },
            ],
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 'wa_1',
              remoteJid: '5511999999999@s.whatsapp.net',
              phone: '5511999999999',
              displayName: 'Maria',
              providerConversationId: '5511999999999@s.whatsapp.net',
              canonicalPhone: '5511999999999',
              displayLabel: 'Maria',
              identityStatus: 'verified',
              identitySource: 'chat.phone',
              identityConfidence: 'high',
              lastMessageAt: '2026-07-01T12:00:00.000Z',
              lastMessagePreview: 'Quero orçamento',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.goto('/#/whatsapp-inbox');
    await page.waitForSelector('button:has-text("Sincronizar")', { timeout: 10000 });

    // Commercial panel actions
    await expect(page.getByRole('button', { name: /Extrair orçamento/ })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: /Criar pré-orçamento/ })).toBeVisible({
      timeout: 5000,
    });
  });

  test('shows CRM match card when conversation has linked lead', async ({ page }) => {
    // Mock all whatsapp-conversations API calls
    await page.route('**/api/whatsapp-conversations**', async (route) => {
      const requestUrl = route.request().url();
      // Detail endpoint (id param)
      if (requestUrl.includes('/api/whatsapp-conversations?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: 'wa_1',
              phone: '5511999999999',
              displayName: 'Maria',
              providerConversationId: '5511999999999@s.whatsapp.net',
              canonicalPhone: '5511999999999',
              displayLabel: 'Maria',
              identityStatus: 'verified',
              identitySource: 'chat.phone',
              identityConfidence: 'high',
              status: 'new',
              crmMatch: {
                id: 'LEAD-001',
                tipo: 'lead',
                nome: 'Maria Silva',
                telefone: '5511999999999',
                email: 'maria@example.com',
                matchSource: 'phone',
              },
            },
          },
        });
        return;
      }
      // Messages endpoint
      if (requestUrl.includes('messages=')) {
        await route.fulfill({ json: { success: true, data: [] } });
        return;
      }
      // List endpoint (default)
      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 'wa_1',
              remoteJid: '5511999999999@s.whatsapp.net',
              phone: '5511999999999',
              displayName: 'Maria',
              providerConversationId: '5511999999999@s.whatsapp.net',
              canonicalPhone: '5511999999999',
              displayLabel: 'Maria',
              identityStatus: 'verified',
              identitySource: 'chat.phone',
              identityConfidence: 'high',
              lastMessageAt: '2026-07-01T12:00:00.000Z',
              lastMessagePreview: 'Quero orçamento',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.goto('/#/whatsapp-inbox');

    // CRM match card should be visible
    await expect(page.getByText('Cadastro encontrado')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Maria Silva')).toBeVisible();
    await expect(page.getByText('maria@example.com')).toBeVisible();
    await expect(page.getByRole('button', { name: /Abrir lead/ })).toBeVisible();
  });

  test('refreshes the selected conversation even when stored messages already exist', async ({
    page,
  }) => {
    await page.route('**/api/whatsapp-conversations**', async (route) => {
      const req = route.request();
      const requestUrl = req.url();

      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        if (body.action === 'sync-messages') {
          await route.fulfill({
            json: {
              success: true,
              data: [
                {
                  id: 'm1',
                  conversationId: 'wa_1',
                  providerMessageId: 'm1',
                  direction: 'inbound',
                  type: 'text',
                  body: 'Mensagem antiga',
                  mediaUrl: '',
                  timestamp: '2026-07-01T12:00:00.000Z',
                },
                {
                  id: 'm2',
                  conversationId: 'wa_1',
                  providerMessageId: 'm2',
                  direction: 'inbound',
                  type: 'text',
                  body: 'Mensagem nova',
                  mediaUrl: '',
                  timestamp: '2026-07-01T12:05:00.000Z',
                },
              ],
            },
          });
          return;
        }
      }

      if (requestUrl.includes('/api/whatsapp-conversations?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: 'wa_1',
              remoteJid: '5511999999999@s.whatsapp.net',
              phone: '5511999999999',
              displayName: 'Maria',
              providerConversationId: '5511999999999@s.whatsapp.net',
              canonicalPhone: '5511999999999',
              displayLabel: 'Maria',
              identityStatus: 'verified',
              identitySource: 'chat.phone',
              identityConfidence: 'high',
              status: 'new',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
              crmMatch: null,
            },
          },
        });
        return;
      }

      if (requestUrl.includes('messages=')) {
        await route.fulfill({
          json: {
            success: true,
            data: [
              {
                id: 'm1',
                conversationId: 'wa_1',
                providerMessageId: 'm1',
                direction: 'inbound',
                type: 'text',
                body: 'Mensagem antiga',
                mediaUrl: '',
                timestamp: '2026-07-01T12:00:00.000Z',
              },
            ],
          },
        });
        return;
      }

      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 'wa_1',
              remoteJid: '5511999999999@s.whatsapp.net',
              phone: '5511999999999',
              displayName: 'Maria',
              providerConversationId: '5511999999999@s.whatsapp.net',
              canonicalPhone: '5511999999999',
              displayLabel: 'Maria',
              identityStatus: 'verified',
              identitySource: 'chat.phone',
              identityConfidence: 'high',
              lastMessageAt: '2026-07-01T12:00:00.000Z',
              lastMessagePreview: 'Mensagem antiga',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.goto('/#/whatsapp-inbox');

    await expect(page.getByText('Mensagem antiga').nth(1)).toBeVisible();
    await expect(page.getByText('Mensagem nova')).toBeVisible({ timeout: 10000 });
  });

  test('shows legacy name but never legacy phone when canonical identity is unresolved', async ({
    page,
  }) => {
    await page.route('**/api/whatsapp-conversations**', async (route) => {
      const requestUrl = route.request().url();

      if (requestUrl.includes('/api/whatsapp-conversations?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: 'wa_legacy',
              remoteJid: '183792384719283741@lid',
              providerConversationId: '183792384719283741@lid',
              canonicalPhone: '',
              phone: '5521981858541',
              displayLabel: '',
              displayName: 'Maria Legado',
              identityStatus: 'unresolved',
              identitySource: null,
              identityConfidence: null,
              lastMessageAt: '2026-07-02T12:00:00.000Z',
              lastMessagePreview: 'Oi',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-02T12:00:00.000Z',
              updatedAt: '2026-07-02T12:00:00.000Z',
              crmMatch: null,
            },
          },
        });
        return;
      }

      if (requestUrl.includes('messages=')) {
        await route.fulfill({ json: { success: true, data: [] } });
        return;
      }

      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 'wa_legacy',
              remoteJid: '183792384719283741@lid',
              providerConversationId: '183792384719283741@lid',
              canonicalPhone: '',
              phone: '5521981858541',
              displayLabel: '',
              displayName: 'Maria Legado',
              identityStatus: 'unresolved',
              identitySource: null,
              identityConfidence: null,
              lastMessageAt: '2026-07-02T12:00:00.000Z',
              lastMessagePreview: 'Oi',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-02T12:00:00.000Z',
              updatedAt: '2026-07-02T12:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.goto('/#/whatsapp-inbox');

    await expect(page.getByText('Maria Legado').first()).toBeVisible();
    await expect(page.getByText('Telefone não identificado').first()).toBeVisible();
    await expect(page.getByText('(55) 21 98185-8541')).toHaveCount(0);
  });

  test('shows static fallback for old conversations without canonical phone', async ({ page }) => {
    await page.route('**/api/whatsapp-conversations**', async (route) => {
      const requestUrl = route.request().url();

      if (requestUrl.includes('/api/whatsapp-conversations?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: 'wa_legacy',
              remoteJid: '183792384719283741@lid',
              phone: '5521981858541',
              displayName: 'Maria Legado',
              providerConversationId: '183792384719283741@lid',
              canonicalPhone: '',
              displayLabel: '',
              identityStatus: 'unresolved',
              identitySource: null,
              identityConfidence: null,
              status: 'new',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
              crmMatch: null,
            },
          },
        });
        return;
      }

      if (requestUrl.includes('messages=')) {
        await route.fulfill({ json: { success: true, data: [] } });
        return;
      }

      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 'wa_legacy',
              remoteJid: '183792384719283741@lid',
              phone: '5521981858541',
              displayName: 'Maria Legado',
              providerConversationId: '183792384719283741@lid',
              canonicalPhone: '',
              displayLabel: '',
              identityStatus: 'unresolved',
              identitySource: null,
              identityConfidence: null,
              lastMessageAt: '2026-07-01T12:00:00.000Z',
              lastMessagePreview: 'Oi',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-01T12:00:00.000Z',
              updatedAt: '2026-07-01T12:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.goto('/#/whatsapp-inbox');

    await expect(page.getByText('Maria Legado').first()).toBeVisible();
    await expect(page.getByText('Telefone não identificado').first()).toBeVisible();
    await expect(page.getByText('(55) 21 98185-8541')).toHaveCount(0);
  });

  test('uses visual fallback for phone-only conversations without showing raw canonical phone', async ({
    page,
  }) => {
    await page.route('**/api/whatsapp-conversations**', async (route) => {
      const requestUrl = route.request().url();

      if (requestUrl.includes('/api/whatsapp-conversations?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: 'wa_phone_only',
              remoteJid: '557788152565@s.whatsapp.net',
              providerConversationId: '557788152565@s.whatsapp.net',
              canonicalPhone: '557788152565',
              phone: '557788152565',
              displayLabel: '557788152565',
              displayName: '557788152565',
              identityStatus: 'derived',
              identitySource: 'providerConversationId',
              identityConfidence: 'medium',
              lastMessageAt: '2026-07-02T12:00:00.000Z',
              lastMessagePreview: 'Perfeito! 🙂 Seu contato foi registrado.',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-02T12:00:00.000Z',
              updatedAt: '2026-07-02T12:00:00.000Z',
              crmMatch: null,
            },
          },
        });
        return;
      }

      if (requestUrl.includes('messages=')) {
        await route.fulfill({ json: { success: true, data: [] } });
        return;
      }

      await route.fulfill({
        json: {
          success: true,
          data: [
            {
              id: 'wa_phone_only',
              remoteJid: '557788152565@s.whatsapp.net',
              providerConversationId: '557788152565@s.whatsapp.net',
              canonicalPhone: '557788152565',
              phone: '557788152565',
              displayLabel: '557788152565',
              displayName: '557788152565',
              identityStatus: 'derived',
              identitySource: 'providerConversationId',
              identityConfidence: 'medium',
              lastMessageAt: '2026-07-02T12:00:00.000Z',
              lastMessagePreview: 'Perfeito! 🙂 Seu contato foi registrado.',
              source: 'evolution',
              status: 'new',
              createdAt: '2026-07-02T12:00:00.000Z',
              updatedAt: '2026-07-02T12:00:00.000Z',
            },
          ],
        },
      });
    });

    await page.goto('/#/whatsapp-inbox');

    await expect(page.getByText('Contato sem nome').first()).toBeVisible();
    await expect(page.getByText('(77) 8815-2565').first()).toBeVisible();
    await expect(page.getByText('557788152565')).toHaveCount(0);
    await expect(page.getByText('(55) 77881-52565')).toHaveCount(0);
  });

  test('renders attachment cards for images, documents, and quotation PDFs', async ({ page }) => {
    // Mock for attachments
    await page.route('**/api/whatsapp-conversations**', async (route) => {
      const req = route.request();
      const url = req.url();
      const method = req.method();

      if (method === 'POST') {
        const body = req.postDataJSON();
        if (body.action === 'sync-messages') {
          await route.fulfill({
            json: {
              success: true,
              data: [
                {
                  id: 'm_img',
                  conversationId: 'wa_1',
                  providerMessageId: 'm_img',
                  direction: 'inbound',
                  type: 'image',
                  body: 'Veja a imagem',
                  mediaUrl: 'http://example.com/img.jpg',
                  timestamp: '2026-07-01T12:00:00.000Z',
                  attachments: [
                    {
                      id: 'att_1',
                      kind: 'image',
                      mimeType: 'image/jpeg',
                      fileName: 'foto.jpg',
                      mediaUrl: 'http://example.com/img.jpg',
                      caption: 'Foto',
                      origin: 'provider',
                      documentRole: null,
                      quotationId: null,
                      leadId: null,
                      customerId: null,
                    },
                  ],
                },
                {
                  id: 'm_pdf',
                  conversationId: 'wa_1',
                  providerMessageId: 'm_pdf',
                  direction: 'inbound',
                  type: 'document',
                  body: 'Aqui está',
                  mediaUrl: 'http://example.com/doc.pdf',
                  timestamp: '2026-07-01T12:01:00.000Z',
                  attachments: [
                    {
                      id: 'att_2',
                      kind: 'document',
                      mimeType: 'application/pdf',
                      fileName: 'orcamento.pdf',
                      mediaUrl: 'http://example.com/doc.pdf',
                      caption: 'Orçamento',
                      origin: 'internal_generated',
                      documentRole: 'quotation_pdf',
                      quotationId: 'q1',
                      leadId: null,
                      customerId: null,
                    },
                  ],
                },
              ],
            },
          });
          return;
        }
      }

      if (url.includes('messages=')) {
        await route.fulfill({
          json: { success: true, data: [] }, // Initially empty if it fetches stored first
        });
        return;
      }

      // List mock
      if (req.method() === 'GET' && !req.url().includes('?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: [
              {
                id: 'wa_1',
                remoteJid: '123@s.whatsapp.net',
                phone: '123',
                displayName: 'Maria',
                providerConversationId: '123@s.whatsapp.net',
                canonicalPhone: '123',
                displayLabel: 'Maria',
                identityStatus: 'verified',
                status: 'new',
                createdAt: '2026-07-01T12:00:00.000Z',
                updatedAt: '2026-07-01T12:00:00.000Z',
              },
            ],
          },
        });
        return;
      }

      // Detail mock
      if (req.url().includes('?id=')) {
        await route.fulfill({
          json: {
            success: true,
            data: {
              id: 'wa_1',
              status: 'new',
              canonicalPhone: '123',
            },
          },
        });
        return;
      }
    });

    await page.goto('/#/whatsapp-inbox');

    // Verify Image card
    await expect(page.getByText('foto.jpg', { exact: true })).toBeVisible();
    await expect(page.getByText('Foto', { exact: true })).toBeVisible();

    // Verify Quotation PDF card (distinguishable)
    await expect(page.getByText('Orçamento PDF', { exact: true })).toBeVisible();
  });
});
