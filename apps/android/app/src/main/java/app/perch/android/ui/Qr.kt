package app.perch.android.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.ContextCompat
import app.perch.android.R
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeWriter
import java.util.concurrent.Executors

/** A QR code for [text], drawn on the device (ZXing), black on white so any camera reads it. */
@Composable
fun QrCode(text: String, size: Dp = 220.dp) {
  val bitmap = remember(text) {
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 1))
    val pixels = IntArray(matrix.width * matrix.height) { i ->
      if (matrix[i % matrix.width, i / matrix.width]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
    }
    Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888).asImageBitmap()
  }
  Box(Modifier.clip(RoundedCornerShape(16.dp)).background(Color.White).padding(10.dp)) {
    Image(bitmap, contentDescription = null, filterQuality = FilterQuality.None, modifier = Modifier.size(size))
  }
}

/**
 * A full-screen camera that reads one QR code and hands back its text. The
 * camera is asked for here, and only for this.
 */
@Composable
fun QrScanner(onResult: (String) -> Unit, onDismiss: () -> Unit) {
  val context = LocalContext.current
  var granted by remember {
    mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
  }
  val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
    granted = ok
    if (!ok) onDismiss()
  }
  LaunchedEffect(Unit) { if (!granted) ask.launch(Manifest.permission.CAMERA) }

  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Box(Modifier.fillMaxSize().background(Color.Black)) {
      if (granted) CameraPreview(onResult)
      Box(Modifier.align(Alignment.Center).size(260.dp).border(3.dp, Color.White.copy(alpha = 0.85f), RoundedCornerShape(28.dp)))
      Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(R.string.scan_hint), color = Color.White, fontSize = 15.sp, textAlign = TextAlign.Center)
      }
      GlassIconButton(Icons.Rounded.Close, stringResource(R.string.cancel), modifier = Modifier.statusBarsPadding().padding(16.dp), tint = Color.White, onClick = onDismiss)
    }
  }
}

@Composable
private fun CameraPreview(onResult: (String) -> Unit) {
  val context = LocalContext.current
  val owner = LocalLifecycleOwner.current
  val executor = remember { Executors.newSingleThreadExecutor() }
  var done by remember { mutableStateOf(false) }
  val reader = remember {
    MultiFormatReader().apply { setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE), DecodeHintType.TRY_HARDER to true)) }
  }
  DisposableEffect(Unit) { onDispose { executor.shutdown() } }
  AndroidView(
    modifier = Modifier.fillMaxSize(),
    factory = { ctx ->
      val view = PreviewView(ctx)
      val future = ProcessCameraProvider.getInstance(ctx)
      future.addListener({
        val provider = future.get()
        val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
        val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
        analysis.setAnalyzer(executor) { image ->
          try {
            if (done) return@setAnalyzer
            val plane = image.planes[0]
            val buffer = plane.buffer
            val bytes = ByteArray(buffer.remaining()).also { buffer.get(it) }
            val source = PlanarYUVLuminanceSource(bytes, plane.rowStride, image.height, 0, 0, image.width, image.height, false)
            val text = runCatching { reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text }.getOrNull()
            reader.reset()
            if (text != null) {
              done = true
              ContextCompat.getMainExecutor(context).execute { onResult(text) }
            }
          } finally {
            image.close()
          }
        }
        provider.unbindAll()
        runCatching { provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis) }
      }, ContextCompat.getMainExecutor(ctx))
      view
    },
  )
}
