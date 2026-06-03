import sys
from unittest.mock import MagicMock
sys.modules['tensorflow_decision_forests'] = MagicMock()
import tensorflowjs as tfjs
print('TFJS mock success!')
tfjs.converters.save_keras_model(MagicMock(), 'export_dir')
