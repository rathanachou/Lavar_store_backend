const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const dayjs = require("dayjs");

const khmerDays = [
  "អាទិត្យ",
  "ច័ន្ទ",
  "អង្គារ",
  "ពុធ",
  "ព្រហស្បតិ៍",
  "សុក្រ",
  "សៅរ៍",
];

const khmerMonths = [
  "មករា",
  "កុម្ភៈ",
  "មីនា",
  "មេសា",
  "ឧសភា",
  "មិថុនា",
  "កក្កដា",
  "សីហា",
  "កញ្ញា",
  "តុលា",
  "វិច្ឆិកា",
  "ធ្នូ",
];

const khmerNumberText = (num) => {
  const ones = [
    "",
    "មួយ",
    "ពីរ",
    "បី",
    "បួន",
    "ប្រាំ",
    "ប្រាំមួយ",
    "ប្រាំពីរ",
    "ប្រាំបី",
    "ប្រាំបួន",
  ];

  const tens = [
    "",
    "ដប់",
    "ម្ភៃ",
    "សាមសិប",
    "សែសិប",
    "ហាសិប",
    "ហុកសិប",
    "ចិតសិប",
    "ប៉ែតសិប",
    "កៅសិប",
  ];

  if (num === 0) return "សូន្យ";

  // < 10
  if (num < 10) return ones[num];

  // 10–19
  if (num < 20) return num === 10 ? "ដប់" : "ដប់" + ones[num - 10];

  // 20–99
  if (num < 100) {
    const t = Math.floor(num / 10);
    const o = num % 10;
    return tens[t] + (o ? ones[o] : "");
  }

  // 100–999
  if (num < 1000) {
    const h = Math.floor(num / 100);
    const r = num % 100;
    return ones[h] + "រយ" + (r ? khmerNumberText(r) : "");
  }

  // 1000–9999 (years)
  if (num < 10000) {
    const th = Math.floor(num / 1000);
    const r = num % 1000;
    return ones[th] + "ពាន់" + (r ? khmerNumberText(r) : "");
  }

  return num.toString();
};


const toKhmerNumber = (num) => {
  const khmerDigits = ["០", "១", "២", "៣", "៤", "៥", "៦", "៧", "៨", "៩"];
  return num
    .toString()
    .split("")
    .map((d) => khmerDigits[d])
    .join("");
};

const getKhmerDate = (date = new Date()) => {
  const d = dayjs(date);

  return `ថ្ងៃ${khmerDays[d.day()]} ទី${khmerNumberText(d.date())} ខែ${khmerMonths[d.month()]} ឆ្នាំ${khmerNumberText(d.year())}`;
};

const generateDoc = (order) => {
  console.log("Order", order);

  const templatePath = path.join(
    __dirname,
    "../templates/Invoice_template.docx",
  );

  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
  });

  console.log("Khmer text", getKhmerDate());

  doc.render({
    orderNumber: order.orderNumber,
    orderDate: dayjs(order.orderDate).format("DD-MM-YYYY"),
    firstName: order.customer.firstName,
    lastName: order.customer.lastName,
    discount: order.discount,
    total: order.total,
    items: order.orderDetails,
    khmerDate: getKhmerDate(),
  });

  const buffer = doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return buffer;
};

module.exports = generateDoc;
