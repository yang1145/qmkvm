import { ContactForm } from "@/components/sections/contact-form";

/** 联系销售区块（表单入口，锚点 #contact） */
export function Contact() {
  return (
    <section id="contact" className="scroll-mt-20 pb-4 pt-4">
      <div className="mx-auto max-w-xl px-4 sm:px-6">
        <ContactForm />
      </div>
    </section>
  );
}
