from pypdf import PdfReader
import docx

def extract_text_from_file(uploaded_file):
    filename = uploaded_file.name.lower()

    # --- PDF ---
    if filename.endswith(".pdf"):
        reader = PdfReader(uploaded_file)
        text = ""

        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"

        return text.strip()

    # --- DOCX ---
    if filename.endswith(".docx"):
        doc = docx.Document(uploaded_file)
        return "\n".join([para.text for para in doc.paragraphs])

    # --- TXT ---
    if filename.endswith(".txt"):
        return uploaded_file.read().decode("utf-8")

    return ""