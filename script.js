const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const captureBtn = document.getElementById("captureBtn");
const filterBtn = document.getElementById("filterBtn");
const pdfBtn = document.getElementById("pdfBtn");
const retakeBtn = document.getElementById("retakeBtn");
const actionControls = document.getElementById("actionControls");

let stream;

// ক্যামেরা চালু করা
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }, // পেছনের ক্যামেরা
    });
    video.srcObject = stream;
    video.style.display = "block";
    canvas.style.display = "none";
    actionControls.style.display = "none";
    captureBtn.style.display = "block";
  } catch (err) {
    alert("ক্যামেরা চালু করা যাচ্ছে না। দয়া করে পারমিশন দিন।");
    console.error(err);
  }
}

// ছবি তোলা
captureBtn.addEventListener("click", () => {
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  video.style.display = "none";
  captureBtn.style.display = "none";
  canvas.style.display = "block";
  actionControls.style.display = "flex";
});

// আবার ছবি তোলা
retakeBtn.addEventListener("click", () => {
  startCamera();
});

// স্ক্যানার ফিল্টার (Grayscale & High Contrast)
filterBtn.addEventListener("click", () => {
  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    // Grayscale করা
    let avg = (data[i] + data[i + 1] + data[i + 2]) / 3;

    // Contrast বাড়ানো (সাদাকে আরও সাদা, কালোকে আরও কালো করা)
    let contrast = 1.5; // কনট্রাস্ট লেভেল
    let factor =
      (259 * (contrast * 255 + 255)) / (255 * (259 - contrast * 255));
    let newValue = factor * (avg - 128) + 128;

    data[i] = newValue; // Red
    data[i + 1] = newValue; // Green
    data[i + 2] = newValue; // Blue
  }
  ctx.putImageData(imageData, 0, 0);
});

// PDF ডাউনলোড করা
pdfBtn.addEventListener("click", () => {
  const { jsPDF } = window.jspdf;

  // A4 সাইজের PDF তৈরি
  const pdf = new jsPDF({
    orientation: canvas.width > canvas.height ? "landscape" : "portrait",
    unit: "px",
    format: [canvas.width, canvas.height],
  });

  const imgData = canvas.toDataURL("image/jpeg", 1.0);
  pdf.addImage(imgData, "JPEG", 0, 0, canvas.width, canvas.height);
  pdf.save("Scanned_Document.pdf");
});

// পেজ লোড হলে ক্যামেরা চালু হবে
window.addEventListener("load", startCamera);
