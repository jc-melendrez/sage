"""Extract plain text from uploaded study material.

One implementation, used by every upload path (chat attachments, AI quiz
generation, lesson/topic generation) so a .docx is read the same way
regardless of which endpoint it arrives through.
"""

from io import BytesIO

from pypdf import PdfReader


# Office MIME types the picker can hand us. The app also sends bare
# extensions, which are what we branch on below.
TEXT_EXTENSIONS = {".txt", ".md", ".markdown", ".csv"}

# Word 97 / PowerPoint 97 are OLE compound binaries. No pure-Python reader
# exists for them, so we ask the user to re-save instead of returning
# garbled output.
LEGACY_OFFICE_EXTENSIONS = {
    ".doc": ".docx",
    ".ppt": ".pptx",
}

SUPPORTED_EXTENSIONS = (
    ".pdf", ".docx", ".pptx", *TEXT_EXTENSIONS
)


class UnsupportedDocumentFormat(Exception):
    """Raised when a file is a recognised-but-unreadable office format."""


def _extension(filename: str) -> str:
    name = (filename or "").strip().lower()
    if "." not in name:
        return ""
    return name[name.rindex("."):]


def _extract_pdf(raw: bytes) -> str:
    reader = PdfReader(BytesIO(raw))
    pages = [(page.extract_text() or "") for page in reader.pages]
    text = "\n".join(pages).strip()
    if text:
        return text

    # Scanned/image-only PDFs come back empty from pypdf. pdfplumber is
    # already a dependency and does better on table-heavy documents.
    try:
        import pdfplumber

        with pdfplumber.open(BytesIO(raw)) as pdf:
            return "\n".join((page.extract_text() or "") for page in pdf.pages).strip()
    except Exception:
        return ""


def _extract_docx(raw: bytes) -> str:
    import docx

    document = docx.Document(BytesIO(raw))

    parts = [para.text for para in document.paragraphs]

    # python-docx does not surface table cells through .paragraphs, and
    # question/answer material is very often tabular.
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))

    return "\n".join(part for part in parts if part.strip())


def _extract_pptx(raw: bytes) -> str:
    from pptx import Presentation

    presentation = Presentation(BytesIO(raw))

    slides = []
    for slide in presentation.slides:
        lines = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                if text:
                    lines.append(text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells]
                    if any(cells):
                        lines.append(" | ".join(cells))
        if lines:
            slides.append("\n".join(lines))

    return "\n\n".join(slides)


def extract_text_from_bytes(raw: bytes, filename: str) -> str:
    """Return the text content of ``raw``, or '' if the file has none.

    Raises UnsupportedDocumentFormat for legacy .doc/.ppt binaries.
    """
    if not raw:
        return ""

    extension = _extension(filename)

    if extension in LEGACY_OFFICE_EXTENSIONS:
        replacement = LEGACY_OFFICE_EXTENSIONS[extension]
        raise UnsupportedDocumentFormat(
            f"{extension} files cannot be read. Please save the file as "
            f"{replacement} and try again."
        )

    if extension == ".pdf":
        return _extract_pdf(raw)

    if extension == ".docx":
        return _extract_docx(raw)

    if extension == ".pptx":
        return _extract_pptx(raw)

    if extension in TEXT_EXTENSIONS:
        return raw.decode("utf-8", errors="replace").strip()

    # Unknown extension: try a plain-text decode so .rtf-as-text and
    # mislabelled files still work, but never blow up on binary content.
    return raw.decode("utf-8", errors="replace").strip()


def extract_text_from_file(uploaded_file) -> str:
    """Text content of a Django UploadedFile, dispatched on its name."""
    extension = _extension(getattr(uploaded_file, "name", ""))

    if extension in LEGACY_OFFICE_EXTENSIONS:
        replacement = LEGACY_OFFICE_EXTENSIONS[extension]
        raise UnsupportedDocumentFormat(
            f"{extension} files cannot be read. Please save the file as "
            f"{replacement} and try again."
        )

    if extension in TEXT_EXTENSIONS:
        uploaded_file.seek(0)
        return uploaded_file.read().decode("utf-8", errors="replace").strip()

    uploaded_file.seek(0)
    return extract_text_from_bytes(uploaded_file.read(), uploaded_file.name)
