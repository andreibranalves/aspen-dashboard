import {
  Body,
  Button,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
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
const BRAND = 'Aspen Estamparia';
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
      <Preview>Orçamento {businessNumber} - {EMAIL_SUBJECT_BRAND}</Preview>
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
            <Text
              style={{
                color: '#3f4652',
                fontSize: '11px',
                fontWeight: '700',
                letterSpacing: '0.12em',
                lineHeight: '16px',
                margin: '0 0 14px',
                textTransform: 'uppercase',
              }}
            >
              Olá, {customerName}
            </Text>
            <Heading
              as="h1"
              style={{
                color: '#1e3159',
                fontSize: '28px',
                fontWeight: '700',
                letterSpacing: '-0.03em',
                lineHeight: '32px',
                margin: 0,
              }}
            >
              Seu orçamento está pronto
            </Heading>
            <Text style={{ color: '#3f4a5c', fontSize: '15px', lineHeight: '24px', margin: '28px 0 0' }}>
              Segue o orçamento {businessNumber} para sua avaliação.
            </Text>
            <Section data-skip-in-text="true" style={{ margin: '26px 0 0' }}>
              <Button
                href={publicUrl}
                style={{
                  backgroundColor: '#1e3159',
                  borderRadius: '7px',
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
            <Section style={{ backgroundColor: '#f7f8fa', borderRadius: '8px', margin: '28px 0 0', padding: '12px 14px' }}>
              <Text style={{ color: '#596579', fontSize: '12px', lineHeight: '18px', margin: 0 }}>
                O PDF do orçamento está anexado a este e-mail.
              </Text>
            </Section>
            <Text style={{ color: '#3f4a5c', fontSize: '14px', lineHeight: '22px', margin: '28px 0 0' }}>
              Atenciosamente,<br />
              <strong style={{ color: '#1e3159' }}>{BRAND}</strong>
            </Text>
          </Section>
          <Section style={{ backgroundColor: '#fbfcfe', borderTop: '1px solid #e7ebf1', padding: '18px 28px' }}>
            <Text style={{ color: '#8993a3', fontSize: '11px', lineHeight: '16px', margin: 0 }}>
              Este e-mail foi enviado pela {BRAND}.
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
