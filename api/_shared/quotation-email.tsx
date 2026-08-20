import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
  render,
} from 'react-email';

export interface QuotationEmailRenderInput {
  customerName: string;
  businessNumber: string;
  publicUrl: string;
}

export interface RenderedQuotationEmail {
  subject: string;
  html: string;
  text: string;
}

const EMAIL_SUBJECT_PREFIX = 'Orçamento';
const EMAIL_SUBJECT_BRAND = 'Aspen';
const EMAIL_LOGO_PATH = '/email-logo-light.svg';

function emailLogoUrl(publicUrl: string): string {
  try {
    return new URL(EMAIL_LOGO_PATH, new URL(publicUrl).origin).toString();
  } catch {
    return EMAIL_LOGO_PATH;
  }
}

function QuotationEmail({ customerName, businessNumber, publicUrl }: QuotationEmailRenderInput) {
  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>Recebemos seu pedido de orçamento para nossos personalizados.</Preview>
      <Body style={{ backgroundColor: '#f6f8fb', margin: 0, padding: '16px 0' }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: '1px solid #e3e8f0',
            borderRadius: '12px',
            margin: '0 auto',
            maxWidth: '600px',
            overflow: 'hidden',
          }}
        >
          <Section style={{ borderBottom: '1px solid #e7ebf1', padding: '28px 28px 20px' }}>
            <Row>
              <Column style={{ verticalAlign: 'middle', width: '65%' }}>
                <Img
                  alt="Aspen Estamparia"
                  src={emailLogoUrl(publicUrl)}
                  width={138}
                  style={{ display: 'block', height: 'auto', width: '138px' }}
                />
              </Column>
              <Column style={{ verticalAlign: 'middle', width: '35%' }}>
                <Text
                  style={{
                    color: '#3f4652',
                    fontSize: '11px',
                    fontWeight: '700',
                    letterSpacing: '0.08em',
                    lineHeight: '16px',
                    margin: 0,
                    textAlign: 'right',
                  }}
                >
                  {businessNumber}
                </Text>
              </Column>
            </Row>
          </Section>
          <Section style={{ padding: '32px 28px 30px' }}>
            <Text style={{ color: '#3f4a5c', fontSize: '16px', lineHeight: '25px', margin: '0 0 20px' }}>
              <strong>Olá, {customerName}, tudo bem?</strong>
            </Text>
            <Text style={{ color: '#3f4a5c', fontSize: '15px', lineHeight: '24px', margin: '0 0 20px' }}>
              Recebemos seu pedido de orçamento para nossos personalizados e estamos retornando com sua proposta de orçamento em anexo.
            </Text>
            <Text style={{ color: '#3f4a5c', fontSize: '15px', lineHeight: '24px', margin: 0 }}>
              Caso não possua a arte para o personalizado escolhido, contamos com uma equipe de design de ponta para criar uma arte exclusiva para seu projeto sem custos adicionais, se decidir formalizar seu pedido conosco.
            </Text>
            <Section data-skip-in-text="true" style={{ margin: '28px 0 0' }}>
              <Button
                href={publicUrl}
                style={{
                  backgroundColor: '#1e3159',
                  borderRadius: '7px',
                  boxSizing: 'border-box',
                  color: '#ffffff',
                  display: 'inline-block',
                  fontSize: '14px',
                  fontWeight: '700',
                  padding: '14px 20px',
                  textDecoration: 'none',
                }}
              >
                Ver orçamento
              </Button>
            </Section>
            <Text style={{ color: '#3f4a5c', fontSize: '14px', lineHeight: '22px', margin: '28px 0 0' }}>
              Qualquer dúvida, estamos à disposição através dos nossos canais de atendimento:<br />
              <Link href="https://wa.me/5521969241265" style={{ color: '#1e3159', textDecoration: 'none' }}>
                WhatsApp: (21) 96924-1265
              </Link>{' '}
              |{' '}
              <Link href="mailto:contato@aspenestamparia.com" style={{ color: '#1e3159', textDecoration: 'none' }}>
                E-mail: contato@aspenestamparia.com
              </Link>
            </Text>
            <Text style={{ color: '#3f4a5c', fontSize: '14px', lineHeight: '22px', margin: '28px 0 0' }}>
              Atenciosamente,<br />
              <strong style={{ color: '#1e3159' }}>Aspen Estamparia</strong>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export async function renderQuotationEmail(
  input: QuotationEmailRenderInput,
): Promise<RenderedQuotationEmail> {
  const createElement = () => (
    <QuotationEmail
      customerName={input.customerName}
      businessNumber={input.businessNumber}
      publicUrl={input.publicUrl}
    />
  );
  const [html, text] = await Promise.all([
    render(createElement()),
    render(createElement(), { plainText: true }),
  ]);

  return {
    subject: `${EMAIL_SUBJECT_PREFIX} ${input.businessNumber} - ${EMAIL_SUBJECT_BRAND}`,
    html,
    text,
  };
}

export function isRenderedQuotationEmail(value: unknown): value is RenderedQuotationEmail {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 3 &&
    typeof candidate.subject === 'string' &&
    candidate.subject.trim().length > 0 &&
    typeof candidate.html === 'string' &&
    candidate.html.trim().length > 0 &&
    typeof candidate.text === 'string' &&
    candidate.text.trim().length > 0
  );
}
