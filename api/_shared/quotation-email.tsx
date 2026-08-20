import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
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
const BRAND = 'Aspen';

function QuotationEmail({ customerName, businessNumber, publicUrl }: QuotationEmailRenderInput) {
  return (
    <Html lang="pt-BR">
      <Head />
      <Preview>Orçamento {businessNumber} - {BRAND}</Preview>
      <Body style={{ backgroundColor: '#f3f4f6', margin: 0, padding: '24px 0' }}>
        <Container style={{ backgroundColor: '#ffffff', margin: '0 auto', maxWidth: '600px', padding: '32px 24px' }}>
          <Section>
            <Text style={{ color: '#166534', fontSize: '18px', fontWeight: '700', margin: '0 0 24px' }}>
              {BRAND}
            </Text>
            <Heading as="h1" style={{ color: '#111827', fontSize: '24px', fontWeight: '700', margin: '0 0 20px' }}>
              Orçamento {businessNumber}
            </Heading>
            <Text style={{ color: '#1f2937', fontSize: '16px', lineHeight: '24px', margin: '0 0 16px' }}>
              Olá, {customerName}.
            </Text>
            <Text style={{ color: '#1f2937', fontSize: '16px', lineHeight: '24px', margin: '0 0 24px' }}>
              Segue o orçamento {businessNumber} para sua avaliação.
            </Text>
            <Button
              href={publicUrl}
              style={{ backgroundColor: '#166534', borderRadius: '6px', color: '#ffffff', display: 'inline-block', fontSize: '16px', fontWeight: '700', padding: '12px 18px', textDecoration: 'none' }}
            >
              Ver orçamento
            </Button>
            <Text style={{ color: '#4b5563', fontSize: '14px', lineHeight: '21px', margin: '24px 0 4px' }}>
              Se o botão não funcionar, copie e cole este link no navegador:
            </Text>
            <Link href={publicUrl} style={{ color: '#166534', fontSize: '14px', lineHeight: '21px', wordBreak: 'break-all' }}>
              {publicUrl}
            </Link>
            <Hr style={{ borderColor: '#e5e7eb', margin: '28px 0 20px' }} />
            <Text style={{ color: '#4b5563', fontSize: '14px', lineHeight: '21px', margin: '0 0 16px' }}>
              O PDF do orçamento está anexado a este e-mail.
            </Text>
            <Text style={{ color: '#1f2937', fontSize: '16px', lineHeight: '24px', margin: 0 }}>
              Atenciosamente,<br />
              {BRAND}
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
    subject: `${EMAIL_SUBJECT_PREFIX} ${input.businessNumber} - ${BRAND}`,
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
